import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, User, UserType } from '@prisma/client';
import { Mailer } from '@platform/mail';
import { SmsSender } from '@platform/sms';
import { LoginDto, RegisterDto } from '../dto/auth.dto';
import { AuthTokens, TokenService } from './token.service';
import { PasswordService } from './password.service';
import { PhoneCodeService } from './phone-code.service';
import { UserService } from './user.service';
import { VerificationCodeService } from './verification-code.service';

const DEFAULT_PHONE_USER_TYPE = UserType.CREATOR;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UserService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly codes: VerificationCodeService,
    private readonly phoneCodes: PhoneCodeService,
    private readonly mailer: Mailer,
    private readonly sms: SmsSender,
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

    await this.deliverVerificationCode(user.id, dto.email);

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
    if (!user?.email || user.emailVerifiedAt) {
      return;
    }
    await this.deliverVerificationCode(user.id, user.email);
  }

  /**
   * Starts a password reset. Always resolves — whether or not the email exists —
   * so the endpoint never reveals which addresses are registered. A phone-only
   * account has no inbox to reset against, so it is treated as a no-op too.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (!user?.email) {
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

  /**
   * Issues an email-verification code and tries to deliver it, never propagating a
   * delivery failure to the caller.
   *
   * The code is keyed to a user that already exists, so mail cannot be sent before
   * the row is written. Letting a send failure fail the request instead would strand
   * an account in PENDING that can never be completed — the account would be created
   * but the response would say the signup failed, and a retry would report the email
   * as already registered. The code is still issued, so the authenticated resend
   * endpoint (and the client's resend button) can deliver it once the provider
   * recovers. Failure is logged at error level so a broken mail configuration is
   * still visible; neither the code nor the address is logged.
   */
  private async deliverVerificationCode(userId: string, email: string): Promise<void> {
    const code = await this.codes.issue(userId, 'EMAIL_VERIFICATION');
    try {
      await this.mailer.sendEmailVerificationCode(email, code);
    } catch (error) {
      this.logger.error(
        'Failed to deliver an email-verification code; the account is created and the ' +
          'code can be re-sent from the app. Recipient withheld.',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /**
   * Starts phone-number sign-in: texts a 6-digit code to the number. The account
   * does not have to exist yet — the same endpoint both signs in a known number
   * and starts a sign-up for an unknown one — so there is nothing to disclose and
   * the response is always 204.
   */
  async requestPhoneCode(phone: string): Promise<void> {
    const code = await this.phoneCodes.issue(phone);
    await this.sms.sendVerificationCode(phone, code);
  }

  /**
   * Completes phone-number sign-in or sign-up. A correct code proves control of the
   * number, which both authenticates a returning user and creates the account for
   * a first-time one, so both paths return tokens and the client routes on the
   * resulting profile.
   */
  async verifyPhoneCode(phone: string, code: string, userType?: UserType): Promise<AuthTokens> {
    await this.phoneCodes.consume(phone, code);

    const existing = await this.users.findByPhone(phone);
    if (existing) {
      if (existing.status === 'SUSPENDED') {
        throw new ForbiddenException('This account is suspended.');
      }
      return this.tokens.issueFor(existing);
    }

    const user = await this.createPhoneUser(phone, userType ?? DEFAULT_PHONE_USER_TYPE);
    return this.tokens.issueFor(user);
  }

  /**
   * Two clients can race to claim the same new number; the loser gets the unique
   * violation and is treated as the winner's, so both end up signed in as the
   * single account that now holds the number.
   */
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
