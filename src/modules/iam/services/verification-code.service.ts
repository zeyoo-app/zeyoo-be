import { BadRequestException, Injectable } from '@nestjs/common';
import { VerificationPurpose } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { PrismaService } from '@platform/database/prisma.service';
import { PasswordService } from './password.service';

const CODE_LENGTH = 6;
const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 5;

/**
 * Issues and checks the short-lived 6-digit codes used for email verification
 * and password reset. Codes are stored only as argon2 hashes, are single-use,
 * expire quickly, and are attempt-limited to make the small 6-digit space
 * impractical to brute-force online. Issuing a new code for a (user, purpose)
 * invalidates any earlier outstanding one.
 */
@Injectable()
export class VerificationCodeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
  ) {}

  /** Creates and persists a fresh code, returning the plaintext for delivery. */
  async issue(userId: string, purpose: VerificationPurpose): Promise<string> {
    const code = this.generateCode();
    const codeHash = await this.passwords.hash(code);

    await this.prisma.$transaction([
      this.prisma.verificationCode.deleteMany({
        where: { userId, purpose, consumedAt: null },
      }),
      this.prisma.verificationCode.create({
        data: {
          userId,
          purpose,
          codeHash,
          expiresAt: new Date(Date.now() + CODE_TTL_MS),
        },
      }),
    ]);

    return code;
  }

  /**
   * Consumes a code, throwing {@link BadRequestException} on any failure
   * (unknown/expired/too-many-attempts/mismatch). The same message is used for
   * every failure so callers cannot distinguish the cause.
   */
  async consume(userId: string, purpose: VerificationPurpose, code: string): Promise<void> {
    const record = await this.prisma.verificationCode.findFirst({
      where: { userId, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });

    if (!record || record.attempts >= MAX_ATTEMPTS) {
      throw new BadRequestException('This code is invalid or has expired.');
    }

    const matches = await this.passwords.verify(record.codeHash, code);
    if (!matches) {
      await this.prisma.verificationCode.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException('This code is invalid or has expired.');
    }

    await this.prisma.verificationCode.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });
  }

  private generateCode(): string {
    return randomInt(0, 10 ** CODE_LENGTH)
      .toString()
      .padStart(CODE_LENGTH, '0');
  }
}
