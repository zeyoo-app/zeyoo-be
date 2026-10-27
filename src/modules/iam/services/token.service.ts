import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { StaffAccount, User } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { AccessTokenClaims } from '@platform/auth';
import { Env } from '@platform/config/env.schema';
import { PrismaService } from '@platform/database/prisma.service';
import { sha256Hex } from '@platform/security/hashing';

export interface AuthTokens {
  tokenType: 'Bearer';
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface IssuedRefreshToken {
  id: string;
  plain: string;
}

const REFRESH_TOKEN_BYTES = 48;

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
  ) {}

  async issueFor(user: Pick<User, 'id' | 'email' | 'type'>): Promise<AuthTokens> {
    const accessToken = await this.signAccessToken(user);
    const refresh = await this.createRefreshToken(user.id);
    return this.buildTokens(accessToken, refresh.plain);
  }

  async rotate(refreshTokenPlain: string): Promise<AuthTokens> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hashToken(refreshTokenPlain) },
      include: { user: true },
    });

    if (!stored || stored.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Invalid refresh token.');
    }
    if (stored.revokedAt) {
      await this.revokeAllForUser(stored.userId);
      throw new UnauthorizedException('Refresh token has already been used.');
    }

    const accessToken = await this.signAccessToken(stored.user);
    const refresh = await this.createRefreshToken(stored.userId);
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date(), replacedById: refresh.id },
    });
    return this.buildTokens(accessToken, refresh.plain);
  }

  async revoke(refreshTokenPlain: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.hashToken(refreshTokenPlain), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Revokes every active session for a user (e.g. after a password reset). */
  async revokeAll(userId: string): Promise<void> {
    await this.revokeAllForUser(userId);
  }

  /** A back-office session: the token's subject is the staff account, marked `kind: 'staff'`. */
  async issueForStaff(staff: Pick<StaffAccount, 'id' | 'email' | 'role'>): Promise<AuthTokens> {
    const accessToken = await this.signStaffAccessToken(staff);
    const refresh = await this.createStaffRefreshToken(staff.id);
    return this.buildTokens(accessToken, refresh.plain);
  }

  /** {@link rotate} for staff sessions; a deactivated account cannot refresh. */
  async rotateStaff(refreshTokenPlain: string): Promise<AuthTokens> {
    const stored = await this.prisma.staffRefreshToken.findUnique({
      where: { tokenHash: this.hashToken(refreshTokenPlain) },
      include: { staff: true },
    });

    if (!stored || stored.expiresAt.getTime() <= Date.now() || stored.staff.status !== 'ACTIVE') {
      throw new UnauthorizedException('Invalid refresh token.');
    }
    if (stored.revokedAt) {
      await this.prisma.staffRefreshToken.updateMany({
        where: { staffId: stored.staffId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Refresh token has already been used.');
    }

    const accessToken = await this.signStaffAccessToken(stored.staff);
    const refresh = await this.createStaffRefreshToken(stored.staffId);
    await this.prisma.staffRefreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date(), replacedById: refresh.id },
    });
    return this.buildTokens(accessToken, refresh.plain);
  }

  async revokeStaff(refreshTokenPlain: string): Promise<void> {
    await this.prisma.staffRefreshToken.updateMany({
      where: { tokenHash: this.hashToken(refreshTokenPlain), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private buildTokens(accessToken: string, refreshToken: string): AuthTokens {
    return {
      tokenType: 'Bearer',
      accessToken,
      refreshToken,
      expiresIn: this.config.get('JWT_ACCESS_TTL', { infer: true }),
    };
  }

  private signAccessToken(user: Pick<User, 'id' | 'email' | 'type'>): Promise<string> {
    const claims: AccessTokenClaims = { sub: user.id, email: user.email, role: user.type };
    return this.jwt.signAsync(claims);
  }

  private signStaffAccessToken(
    staff: Pick<StaffAccount, 'id' | 'email' | 'role'>,
  ): Promise<string> {
    const claims: AccessTokenClaims = {
      sub: staff.id,
      email: staff.email,
      role: staff.role,
      kind: 'staff',
    };
    return this.jwt.signAsync(claims);
  }

  private async createStaffRefreshToken(staffId: string): Promise<IssuedRefreshToken> {
    const plain = randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
    const expiresAt = new Date(
      Date.now() + this.config.get('JWT_REFRESH_TTL', { infer: true }) * 1000,
    );
    const created = await this.prisma.staffRefreshToken.create({
      data: { staffId, tokenHash: this.hashToken(plain), expiresAt },
      select: { id: true },
    });
    return { id: created.id, plain };
  }

  private async createRefreshToken(userId: string): Promise<IssuedRefreshToken> {
    const plain = randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
    const expiresAt = new Date(
      Date.now() + this.config.get('JWT_REFRESH_TTL', { infer: true }) * 1000,
    );
    const created = await this.prisma.refreshToken.create({
      data: { userId, tokenHash: this.hashToken(plain), expiresAt },
      select: { id: true },
    });
    return { id: created.id, plain };
  }

  private revokeAllForUser(userId: string): Promise<unknown> {
    return this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private hashToken(plain: string): string {
    return sha256Hex(plain);
  }
}
