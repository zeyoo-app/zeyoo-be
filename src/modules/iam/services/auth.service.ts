import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, User, UserType } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { PrismaService } from '@platform/database/prisma.service';
import { TooManyRequestsException } from '@platform/http/too-many-requests.exception';
import { Mailer } from '@platform/mail';
import { SmsSender } from '@platform/sms';
import { PasswordService } from './password.service';
import { AuthTokens, TokenService } from './token.service';
import { UserService } from './user.service';

const DEFAULT_USER_TYPE = UserType.CREATOR;

type CodeChannel = 'email' | 'phone';

interface StoredCode {
  id: string;
  codeHash: string;
  attempts: number;
}

/** The slice of a Prisma delegate used for one-time codes, identical for both tables. */
interface CodeTable {
  count(args: unknown): Promise<number>;
  findFirst(args: unknown): Promise<unknown>;
  create(args: unknown): Prisma.PrismaPromise<unknown>;
  deleteMany(args: unknown): Prisma.PrismaPromise<unknown>;
  update(args: unknown): Promise<unknown>;
}

const CODE_LENGTH = 6;
const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 5;
/** Shortest gap between two messages to the same address or number, to blunt bombing and SMS pumping. */
const RESEND_COOLDOWN_MS = 45 * 1000;
/** Hard ceiling on messages to one address or number per day. */
const MAX_SENDS_PER_DAY = 10;

/** Tokens plus whether this sign-in created the account, so clients can route onboarding. */
export type SignInResult = AuthTokens & { isNewUser: boolean };

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UserService,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly mailer: Mailer,
    private readonly sms: SmsSender,
  ) {}

  refresh(refreshToken: string): Promise<AuthTokens> {
    return this.tokens.rotate(refreshToken);
  }

  logout(refreshToken: string): Promise<void> {
    return this.tokens.revoke(refreshToken);
  }

  /**
   * Starts email sign-in or sign-up: emails a 6-digit code. The account does not
   * have to exist yet, and nothing is created here. The response never depends on
   * whether the address is registered, so it cannot be used to discover accounts.
   * A delivery failure is reported (the user is waiting on this email) but, being
   * independent of the address, reveals nothing either.
   */
  async requestEmailCode(email: string): Promise<void> {
    const code = await this.issueCode('email', email);
    await this.mailer.sendSignInCode(email, code);
  }

  /**
   * Completes email sign-in or sign-up. A correct code proves control of the
   * inbox, which both authenticates a returning user and creates the account for
   * a first-time one. A returning user's stored role always wins over `userType`.
   */
  async verifyEmailCode(email: string, code: string, userType?: UserType): Promise<SignInResult> {
    await this.consumeCode('email', email, code);

    const existing = await this.users.findByEmail(email);
    if (existing) {
      if (existing.status === 'SUSPENDED') {
        throw new ForbiddenException('This account is suspended.');
      }
      if (!existing.emailVerifiedAt) {
        await this.users.markEmailVerified(existing.id);
      }
      return { ...(await this.tokens.issueFor(existing)), isNewUser: false };
    }

    const user = await this.createEmailUser(email, userType ?? DEFAULT_USER_TYPE);
    return { ...(await this.tokens.issueFor(user)), isNewUser: true };
  }

  /**
   * Starts phone-number sign-in: texts a 6-digit code to the number. The account
   * does not have to exist yet, so the response never depends on it.
   */
  async requestPhoneCode(phone: string): Promise<void> {
    const code = await this.issueCode('phone', phone);
    await this.sms.sendVerificationCode(phone, code);
  }

  /** Completes phone-number sign-in or sign-up, mirroring {@link verifyEmailCode}. */
  async verifyPhoneCode(phone: string, code: string, userType?: UserType): Promise<SignInResult> {
    await this.consumeCode('phone', phone, code);

    const existing = await this.users.findByPhone(phone);
    if (existing) {
      if (existing.status === 'SUSPENDED') {
        throw new ForbiddenException('This account is suspended.');
      }
      return { ...(await this.tokens.issueFor(existing)), isNewUser: false };
    }

    const user = await this.createPhoneUser(phone, userType ?? DEFAULT_USER_TYPE);
    return { ...(await this.tokens.issueFor(user)), isNewUser: true };
  }

  /**
   * Creates and persists a fresh code for an email address or phone number and
   * returns the plaintext for delivery. Codes are keyed by the identifier, not the
   * user, because the account may not exist yet. Only an argon2 hash is stored, and
   * issuing a new code invalidates any earlier one. Throws
   * {@link TooManyRequestsException} past the cooldown or daily ceiling.
   */
  private async issueCode(channel: CodeChannel, identifier: string): Promise<string> {
    const table = this.codeTable(channel);
    await this.assertWithinSendLimits(channel, identifier);

    const code = randomInt(0, 10 ** CODE_LENGTH)
      .toString()
      .padStart(CODE_LENGTH, '0');
    const codeHash = await this.passwords.hash(code);

    await this.prisma.$transaction([
      // Spent rows are dropped so the send history cannot grow without bound.
      table.deleteMany({
        where: {
          [channel]: identifier,
          OR: [{ consumedAt: { not: null } }, { expiresAt: { lte: new Date() } }],
        },
      }),
      table.create({
        data: { [channel]: identifier, codeHash, expiresAt: new Date(Date.now() + CODE_TTL_MS) },
      }),
    ] as Prisma.PrismaPromise<unknown>[]);
    return code;
  }

  /**
   * Single-use, attempt-limited check. Every failure (unknown, expired, too many
   * attempts, mismatch) throws the same message so callers cannot tell the cause.
   */
  private async consumeCode(channel: CodeChannel, identifier: string, code: string): Promise<void> {
    const table = this.codeTable(channel);
    const record = (await table.findFirst({
      where: { [channel]: identifier, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    })) as StoredCode | null;
    if (!record || record.attempts >= MAX_ATTEMPTS) {
      throw new BadRequestException('This code is invalid or has expired.');
    }

    if (!(await this.passwords.verify(record.codeHash, code))) {
      await table.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } });
      throw new BadRequestException('This code is invalid or has expired.');
    }

    await table.update({ where: { id: record.id }, data: { consumedAt: new Date() } });
  }

  private async assertWithinSendLimits(channel: CodeChannel, identifier: string): Promise<void> {
    const table = this.codeTable(channel);
    const now = Date.now();
    const sendsToday = await table.count({
      where: { [channel]: identifier, createdAt: { gte: new Date(now - 24 * 60 * 60 * 1000) } },
    });
    if (sendsToday >= MAX_SENDS_PER_DAY) {
      throw new TooManyRequestsException(
        `Too many codes requested for this ${channel === 'email' ? 'email' : 'number'}. Try again later.`,
      );
    }

    const last = (await table.findFirst({
      where: { [channel]: identifier },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    })) as { createdAt: Date } | null;
    if (last && now - last.createdAt.getTime() < RESEND_COOLDOWN_MS) {
      throw new TooManyRequestsException('Please wait before requesting another code.');
    }
  }

  /** The email and phone code tables share one shape, differing only in the identifier column. */
  private codeTable(channel: CodeChannel): CodeTable {
    return (
      channel === 'email' ? this.prisma.emailVerificationCode : this.prisma.phoneVerificationCode
    ) as unknown as CodeTable;
  }

  /**
   * Two clients can race to claim the same new address; the loser gets the unique
   * violation and is treated as the winner's, so both end up signed in as the
   * single account that now holds it.
   */
  private async createEmailUser(email: string, type: UserType): Promise<User> {
    try {
      return await this.users.createWithEmail({ email, type });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const winner = await this.users.findByEmail(email);
        if (winner) {
          return winner;
        }
      }
      throw error;
    }
  }

  private async createPhoneUser(phone: string, type: UserType): Promise<User> {
    try {
      return await this.users.createWithPhone({ phone, type });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const winner = await this.users.findByPhone(phone);
        if (winner) {
          return winner;
        }
      }
      throw error;
    }
  }
}
