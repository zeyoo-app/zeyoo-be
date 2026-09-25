import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { UserType } from '@prisma/client';
import { Mailer } from '@platform/mail';
import { LoginDto, RegisterDto } from '../dto/auth.dto';
import { AuthTokens, TokenService } from './token.service';
import { PasswordService } from './password.service';
import { UserService } from './user.service';
import { VerificationCodeService } from './verification-code.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UserService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly codes: VerificationCodeService,
    private readonly mailer: Mailer,
  ) {}

  async register(dto: RegisterDto): Promise<AuthTokens> {
    const existing = await this.users.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('An account with this email already exists.');
    }

    const passwordHash = await this.passwords.hash(dto.password);
    const user = await this.users.createWithPassword({
      email: dto.email,
      passwordHash,
      type: dto.userType as UserType,
    });

    await this.sendEmailVerification(user.id, user.email);

    // Tokens are issued immediately so the client can reach the (authenticated)
    // verification endpoint; the account stays PENDING until the code is confirmed.
    return this.tokens.issueFor(user);
  }

  async login(dto: LoginDto): Promise<AuthTokens> {
    const user = await this.users.findByEmailWithCredential(dto.email);
    if (!user?.credential) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const passwordMatches = await this.passwords.verify(user.credential.passwordHash, dto.password);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password.');
    }
    if (user.status === 'SUSPENDED') {
      throw new ForbiddenException('This account is suspended.');
    }
    return this.tokens.issueFor(user);
  }

  refresh(refreshToken: string): Promise<AuthTokens> {
    return this.tokens.rotate(refreshToken);
  }

  logout(refreshToken: string): Promise<void> {
    return this.tokens.revoke(refreshToken);
  }

  /** Confirms the caller's email using the 6-digit code they were sent. */
  async verifyEmail(userId: string, code: string): Promise<void> {
    await this.codes.consume(userId, 'EMAIL_VERIFICATION', code);
    await this.users.markEmailVerified(userId);
  }

  /** Re-issues an email-verification code (no-op if already verified). */
  async resendEmailVerification(userId: string): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user || user.emailVerifiedAt) {
      return;
    }
    await this.sendEmailVerification(user.id, user.email);
  }

  /**
   * Starts a password reset. Always resolves — whether or not the email exists —
   * so the endpoint never reveals which addresses are registered.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (!user) {
      return;
    }
    const code = await this.codes.issue(user.id, 'PASSWORD_RESET');
    await this.mailer.sendPasswordResetCode(user.email, code);
  }

  /** Completes a reset: validates the code, sets the new password, kills sessions. */
  async resetPassword(email: string, code: string, newPassword: string): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (!user) {
      // Mirror the code-service failure so a missing account is indistinguishable.
      throw new BadRequestException('This code is invalid or has expired.');
    }
    await this.codes.consume(user.id, 'PASSWORD_RESET', code);

    const passwordHash = await this.passwords.hash(newPassword);
    await this.users.setPassword(user.id, passwordHash);
    // A reset also confirms control of the inbox.
    if (!user.emailVerifiedAt) {
      await this.users.markEmailVerified(user.id);
    }
    await this.tokens.revokeAll(user.id);
  }

  private async sendEmailVerification(userId: string, email: string): Promise<void> {
    const code = await this.codes.issue(userId, 'EMAIL_VERIFICATION');
    await this.mailer.sendEmailVerificationCode(email, code);
  }
}
