import { Injectable } from '@nestjs/common';
import { OAuthProvider, User, UserStatus, UserType } from '@prisma/client';
import { PrismaService } from '@platform/database/prisma.service';

interface CreateEmailUser {
  email: string;
  type: UserType;
}

interface CreateOAuthUser {
  email: string | null;
  type: UserType;
  emailVerified: boolean;
  provider: OAuthProvider;
  providerUserId: string;
}

interface CreatePhoneUser {
  phone: string;
  type: UserType;
}

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findByPhone(phone: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { phone } });
  }

  listAll(): Promise<User[]> {
    return this.prisma.user.findMany({ orderBy: { createdAt: 'desc' } });
  }

  /**
   * Erases everything that identifies the person — identifiers, sign-in methods,
   * sessions and sign-in codes — and keeps only the bare row that history (ledger,
   * reviews) points at. Irreversible.
   */
  async anonymize(userId: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await this.prisma.$transaction([
      // Prisma treats `undefined` as "no filter", so each code table is only touched
      // for an identifier this user actually has — never with an open-ended delete.
      ...(user.email
        ? [this.prisma.emailVerificationCode.deleteMany({ where: { email: user.email } })]
        : []),
      ...(user.phone
        ? [this.prisma.phoneVerificationCode.deleteMany({ where: { phone: user.phone } })]
        : []),
      this.prisma.oAuthIdentity.deleteMany({ where: { userId } }),
      this.prisma.refreshToken.deleteMany({ where: { userId } }),
      this.prisma.membership.deleteMany({ where: { userId } }),
      this.prisma.user.update({
        where: { id: userId },
        data: {
          email: null,
          phone: null,
          emailVerifiedAt: null,
          phoneVerifiedAt: null,
          status: 'DELETED',
          deletedAt: new Date(),
        },
      }),
    ]);
  }

  setType(userId: string, type: UserType): Promise<User> {
    return this.prisma.user.update({ where: { id: userId }, data: { type } });
  }

  setStatus(userId: string, status: UserStatus): Promise<User> {
    return this.prisma.user.update({ where: { id: userId }, data: { status } });
  }

  /**
   * Creates an account from a verified email address. There is no credential:
   * possession of the inbox is the credential, and the emailed code that proved it
   * is consumed before this runs, so the account is born ACTIVE.
   */
  createWithEmail(input: CreateEmailUser): Promise<User> {
    return this.prisma.user.create({
      data: {
        email: input.email,
        type: input.type,
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
    });
  }

  /**
   * An account for a teammate a brand owner invited by email. The address is not yet
   * verified: their first sign-in with the emailed code proves the inbox and marks it.
   */
  createInvitedBrandUser(email: string): Promise<User> {
    return this.prisma.user.create({
      data: { email, type: 'BRAND_USER', status: 'ACTIVE' },
    });
  }

  /** Marks the address verified and activates the account (idempotent). */
  markEmailVerified(userId: string): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: new Date(), status: 'ACTIVE' },
    });
  }

  /**
   * Creates an account from a verified phone number. There is no credential row:
   * possession of the number is the credential, and the OTP that proved it is
   * consumed before this runs, so the account is born ACTIVE.
   */
  createWithPhone(input: CreatePhoneUser): Promise<User> {
    return this.prisma.user.create({
      data: {
        phone: input.phone,
        type: input.type,
        status: 'ACTIVE',
        phoneVerifiedAt: new Date(),
      },
    });
  }

  /** Attaches a verified phone number to an existing account. */
  attachPhone(userId: string, phone: string): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { phone, phoneVerifiedAt: new Date() },
    });
  }

  /** Resolves the user behind a linked social identity, if any. */
  async findByOAuthIdentity(provider: OAuthProvider, providerUserId: string): Promise<User | null> {
    const identity = await this.prisma.oAuthIdentity.findUnique({
      where: { provider_providerUserId: { provider, providerUserId } },
      include: { user: true },
    });
    return identity?.user ?? null;
  }

  linkOAuthIdentity(
    userId: string,
    provider: OAuthProvider,
    providerUserId: string,
  ): Promise<unknown> {
    return this.prisma.oAuthIdentity.create({
      data: { userId, provider, providerUserId },
    });
  }

  /** Creates a social-only account (no credential row) plus its identity link. */
  createOAuthUser(input: CreateOAuthUser): Promise<User> {
    return this.prisma.user.create({
      data: {
        email: input.email ?? this.placeholderEmail(input),
        type: input.type,
        status: input.emailVerified ? 'ACTIVE' : 'PENDING',
        emailVerifiedAt: input.emailVerified ? new Date() : null,
        oauthIdentities: {
          create: { provider: input.provider, providerUserId: input.providerUserId },
        },
      },
    });
  }

  // Apple can withhold the email on subsequent logins; keep the account keyed by
  // a stable, unique placeholder when no address is available.
  private placeholderEmail(input: CreateOAuthUser): string {
    return `${input.provider.toLowerCase()}_${input.providerUserId}@users.noreply.zeyoo.app`;
  }
}
