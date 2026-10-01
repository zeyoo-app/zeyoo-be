import { BadRequestException, Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { PrismaService } from '@platform/database/prisma.service';
import { TooManyRequestsException } from '@platform/http/too-many-requests.exception';
import { PasswordService } from './password.service';

const CODE_LENGTH = 6;
const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 5;
/** Shortest gap between two messages to the same number, to blunt SMS pumping. */
const RESEND_COOLDOWN_MS = 45 * 1000;
/** Hard ceiling on messages to one number per day. */
const MAX_SENDS_PER_DAY = 10;

/**
 * Issues and checks the 6-digit codes delivered by SMS for phone-number sign-in
 * and sign-up. Mirrors {@link VerificationCodeService} — codes are stored only as
 * argon2 hashes, are single-use, expire quickly, and are attempt-limited so the
 * small 6-digit space is impractical to brute-force online — with two SMS-specific
 * additions: codes are keyed by phone rather than by user, because the account
 * does not exist yet when the code goes out, and sending is rate-limited because
 * a message costs money.
 */
@Injectable()
export class PhoneCodeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
  ) {}

  /**
   * Creates and persists a fresh code, returning the plaintext for delivery.
   * Throws {@link TooManyRequestsException} when the number has been messaged too
   * recently or too many times today.
   */
  async issue(phone: string): Promise<string> {
    await this.assertWithinSendLimits(phone);

    const code = this.generateCode();
    const codeHash = await this.passwords.hash(code);

    await this.prisma.$transaction([
      // Any earlier outstanding code is invalidated, and spent rows for this
      // number are dropped so the send history cannot grow without bound.
      this.prisma.phoneVerificationCode.deleteMany({
        where: {
          phone,
          OR: [{ consumedAt: { not: null } }, { expiresAt: { lte: new Date() } }],
        },
      }),
      this.prisma.phoneVerificationCode.create({
        data: { phone, codeHash, expiresAt: new Date(Date.now() + CODE_TTL_MS) },
      }),
    ]);

    return code;
  }

  /**
   * Consumes a code, throwing {@link BadRequestException} on any failure
   * (unknown/expired/too-many-attempts/mismatch). The same message is used for
   * every failure so callers cannot distinguish the cause.
   */
  async consume(phone: string, code: string): Promise<void> {
    const record = await this.prisma.phoneVerificationCode.findFirst({
      where: { phone, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });

    if (!record || record.attempts >= MAX_ATTEMPTS) {
      throw new BadRequestException('This code is invalid or has expired.');
    }

    const matches = await this.passwords.verify(record.codeHash, code);
    if (!matches) {
      await this.prisma.phoneVerificationCode.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException('This code is invalid or has expired.');
    }

    await this.prisma.phoneVerificationCode.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });
  }

  private async assertWithinSendLimits(phone: string): Promise<void> {
    const now = new Date();
    const sendsToday = await this.prisma.phoneVerificationCode.count({
      where: { phone, createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
    });
    if (sendsToday >= MAX_SENDS_PER_DAY) {
      throw new TooManyRequestsException(
        'Too many codes requested for this number. Try again later.',
      );
    }

    const lastSend = await this.prisma.phoneVerificationCode.findFirst({
      where: { phone },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (lastSend && now.getTime() - lastSend.createdAt.getTime() < RESEND_COOLDOWN_MS) {
      throw new TooManyRequestsException('Please wait before requesting another code.');
    }
  }

  private generateCode(): string {
    return randomInt(0, 10 ** CODE_LENGTH)
      .toString()
      .padStart(CODE_LENGTH, '0');
  }
}
