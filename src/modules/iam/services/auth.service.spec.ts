import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { UserType } from '@prisma/client';
import { Mailer } from '@platform/mail';
import { SmsSender } from '@platform/sms';
import { RegisterDto } from '../dto/auth.dto';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { PhoneCodeService } from './phone-code.service';
import { TokenService } from './token.service';
import { UserService } from './user.service';
import { VerificationCodeService } from './verification-code.service';

const DTO: RegisterDto = {
  email: 'new@example.com',
  password: 'correct horse battery staple',
  userType: UserType.CREATOR,
};

const TOKENS = { accessToken: 'access', refreshToken: 'refresh' } as Awaited<
  ReturnType<TokenService['issueFor']>
>;

/**
 * Registration persists the user before the code can be sent (the code is keyed to
 * the new user id), so a mail outage must not be allowed to fail the request — that
 * would leave an account the caller believes does not exist, retry into a
 * "already registered" conflict, and strand a PENDING row nobody can verify. These
 * tests pin that the failure is swallowed, the code is still issued so the resend
 * endpoint can deliver it, and the outage is logged.
 */
describe('AuthService.register mail delivery', () => {
  const users = {
    findByEmail: jest.fn(),
    createWithPassword: jest.fn(),
  };
  const codes = { issue: jest.fn() };
  const tokens = { issueFor: jest.fn() };
  const mailer = { sendEmailVerificationCode: jest.fn() };

  const service = new AuthService(
    users as unknown as UserService,
    { hash: jest.fn().mockResolvedValue('hash') } as unknown as PasswordService,
    tokens as unknown as TokenService,
    codes as unknown as VerificationCodeService,
    {} as unknown as PhoneCodeService,
    mailer as unknown as Mailer,
    {} as unknown as SmsSender,
  );

  let log: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    users.findByEmail.mockResolvedValue(null);
    users.createWithPassword.mockResolvedValue({ id: 'user_1', email: DTO.email });
    codes.issue.mockResolvedValue('123456');
    tokens.issueFor.mockResolvedValue(TOKENS);
    // Silenced by default so the deliberate failures below do not print stack
    // traces; the logging test asserts on this spy.
    log = jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    log.mockRestore();
  });

  it('returns tokens when the verification email is delivered', async () => {
    mailer.sendEmailVerificationCode.mockResolvedValue(undefined);

    await expect(service.register(DTO)).resolves.toBe(TOKENS);
    expect(mailer.sendEmailVerificationCode).toHaveBeenCalledWith(DTO.email, '123456');
  });

  it('still returns tokens when delivery fails, so the account is not stranded', async () => {
    mailer.sendEmailVerificationCode.mockRejectedValue(
      new ServiceUnavailableException('Plunk rejected the email.'),
    );

    await expect(service.register(DTO)).resolves.toBe(TOKENS);
  });

  it('issues the code even when delivery fails, so resend can deliver it later', async () => {
    mailer.sendEmailVerificationCode.mockRejectedValue(new Error('plunk is down'));

    await service.register(DTO);

    expect(codes.issue).toHaveBeenCalledWith('user_1', 'EMAIL_VERIFICATION');
  });

  it('logs the outage at error level without leaking the code or the address', async () => {
    mailer.sendEmailVerificationCode.mockRejectedValue(new Error('plunk is down'));

    await service.register(DTO);

    expect(log).toHaveBeenCalledTimes(1);
    const [message] = log.mock.calls[0];
    expect(String(message)).toMatch(/failed to deliver/i);
    expect(String(message)).not.toContain(DTO.email);
    expect(String(message)).not.toContain('123456');
  });

  it('still rejects a duplicate address before any mail is attempted', async () => {
    users.findByEmail.mockResolvedValue({ id: 'user_0', email: DTO.email });

    await expect(service.register(DTO)).rejects.toBeInstanceOf(ConflictException);
    expect(mailer.sendEmailVerificationCode).not.toHaveBeenCalled();
  });
});
