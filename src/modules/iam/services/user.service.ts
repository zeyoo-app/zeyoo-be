import { Injectable } from '@nestjs/common';
import { Credential, OAuthProvider, User, UserStatus, UserType } from '@prisma/client';
import { PrismaService } from '@platform/database/prisma.service';

interface CreateUserWithPassword {
  email: string;
  passwordHash: string;
  type: UserType;
}

interface CreateOAuthUser {
  email: string | null;
  type: UserType;
  emailVerified: boolean;
  provider: OAuthProvider;
  providerUserId: string;
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

  listAll(): Promise<User[]> {
    return this.prisma.user.findMany({ orderBy: { createdAt: 'desc' } });
  }

  setStatus(userId: string, status: UserStatus): Promise<User> {
    return this.prisma.user.update({ where: { id: userId }, data: { status } });
  }

  findByEmailWithCredential(
    email: string,
  ): Promise<(User & { credential: Credential | null }) | null> {
    return this.prisma.user.findUnique({
      where: { email },
      include: { credential: true },
    });
  }

  // New password accounts start PENDING and are activated by email verification
  // (see AuthService.verifyEmail). Social sign-in activates on first login when
  // the provider asserts a verified email.
  createWithPassword(input: CreateUserWithPassword): Promise<User> {
    return this.prisma.user.create({
      data: {
        email: input.email,
        type: input.type,
        status: 'PENDING',
        credential: { create: { passwordHash: input.passwordHash } },
      },
    });
  }

  /** Marks the address verified and activates the account (idempotent). */
  markEmailVerified(userId: string): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: new Date(), status: 'ACTIVE' },
    });
  }

  /** Sets (or replaces) the account's password credential. */
  async setPassword(userId: string, passwordHash: string): Promise<void> {
    await this.prisma.credential.upsert({
      where: { userId },
      create: { userId, passwordHash },
      update: { passwordHash },
    });
  }

  /** Resolves the user behind a linked social identity, if any. */
  async findByOAuthIdentity(
    provider: OAuthProvider,
    providerUserId: string,
  ): Promise<User | null> {
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
