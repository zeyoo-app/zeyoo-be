import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { UserType } from '@prisma/client';
import { PrismaService } from '@platform/database/prisma.service';
import { TooManyRequestsException } from '@platform/http/too-many-requests.exception';
import { Mailer } from '@platform/mail';
import { SmsSender } from '@platform/sms';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { UserService } from './user.service';

const EMAIL = 'new@example.com';
const TOKENS = { accessToken: 'access', refreshToken: 'refresh' } as Awaited<
  ReturnType<TokenService['issueFor']>
>;

describe('AuthService email sign-in', () => {
  const users = {
    findByEmail: jest.fn(),
    findByPhone: jest.fn(),
    createWithEmail: jest.fn(),
    createWithPhone: jest.fn(),
    markEmailVerified: jest.fn(),
  };
  const codeTable = {
    count: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    deleteMany: jest.fn(),
    update: jest.fn(),
  };
  const prisma = {
    emailVerificationCode: codeTable,
    // Both channels share one code implementation, so one table mock serves both.
    phoneVerificationCode: codeTable,
    $transaction: jest.fn().mockResolvedValue([]),
  };
  const passwords = { hash: jest.fn(), verify: jest.fn() };
  const tokens = { issueFor: jest.fn() };
  const mailer = { sendSignInCode: jest.fn() };
  const sms = { sendVerificationCode: jest.fn() };

  const service = new AuthService(
    users as unknown as UserService,
    tokens as unknown as TokenService,
    prisma as unknown as PrismaService,
    passwords as unknown as PasswordService,
    mailer as unknown as Mailer,
    sms as unknown as SmsSender,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    codeTable.count.mockResolvedValue(0);
    codeTable.findFirst.mockResolvedValue(null);
    passwords.hash.mockResolvedValue('hashed');
    tokens.issueFor.mockResolvedValue(TOKENS);
  });

  describe('requestEmailCode', () => {
    it('emails a 6-digit code without touching accounts', async () => {
      await service.requestEmailCode(EMAIL);

      expect(mailer.sendSignInCode).toHaveBeenCalledWith(EMAIL, expect.stringMatching(/^\d{6}$/));
      expect(users.findByEmail).not.toHaveBeenCalled();
      expect(users.createWithEmail).not.toHaveBeenCalled();
    });

    it('stores only a hash of the code', async () => {
      await service.requestEmailCode(EMAIL);

      const sent = mailer.sendSignInCode.mock.calls[0][1] as string;
      expect(passwords.hash).toHaveBeenCalledWith(sent);
      expect(JSON.stringify(codeTable.create.mock.calls)).not.toContain(sent);
    });

    it('rate-limits a repeat request inside the cooldown', async () => {
      codeTable.findFirst.mockResolvedValue({ createdAt: new Date() });

      await expect(service.requestEmailCode(EMAIL)).rejects.toBeInstanceOf(
        TooManyRequestsException,
      );
      expect(mailer.sendSignInCode).not.toHaveBeenCalled();
    });

    it('rate-limits past the daily ceiling', async () => {
      codeTable.count.mockResolvedValue(10);

      await expect(service.requestEmailCode(EMAIL)).rejects.toBeInstanceOf(
        TooManyRequestsException,
      );
    });

    it('surfaces a delivery failure instead of pretending the email went out', async () => {
      mailer.sendSignInCode.mockRejectedValue(new ServiceUnavailableException());

      await expect(service.requestEmailCode(EMAIL)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });
  });

  describe('verifyEmailCode', () => {
    const outstanding = { id: 'c1', codeHash: 'hashed', attempts: 0 };

    beforeEach(() => {
      codeTable.findFirst.mockResolvedValue(outstanding);
      passwords.verify.mockResolvedValue(true);
    });

    it('creates the account for a new address and flags it as new', async () => {
      users.findByEmail.mockResolvedValue(null);
      users.createWithEmail.mockResolvedValue({ id: 'u1', email: EMAIL });

      const result = await service.verifyEmailCode(EMAIL, '123456', UserType.BRAND_USER);

      expect(users.createWithEmail).toHaveBeenCalledWith({ email: EMAIL, type: UserType.BRAND_USER });
      expect(result).toEqual({ ...TOKENS, isNewUser: true });
    });

    it('defaults a new account to CREATOR when no role is sent', async () => {
      users.findByEmail.mockResolvedValue(null);
      users.createWithEmail.mockResolvedValue({ id: 'u1', email: EMAIL });

      await service.verifyEmailCode(EMAIL, '123456');

      expect(users.createWithEmail).toHaveBeenCalledWith({ email: EMAIL, type: UserType.CREATOR });
    });

    it('signs a returning user in without creating anything', async () => {
      users.findByEmail.mockResolvedValue({
        id: 'u1',
        email: EMAIL,
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      });

      const result = await service.verifyEmailCode(EMAIL, '123456', UserType.BRAND_USER);

      expect(users.createWithEmail).not.toHaveBeenCalled();
      expect(result).toEqual({ ...TOKENS, isNewUser: false });
    });

    it('refuses a suspended account', async () => {
      users.findByEmail.mockResolvedValue({ id: 'u1', email: EMAIL, status: 'SUSPENDED' });

      await expect(service.verifyEmailCode(EMAIL, '123456')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(tokens.issueFor).not.toHaveBeenCalled();
    });

    it('counts a wrong code and creates nothing', async () => {
      passwords.verify.mockResolvedValue(false);

      await expect(service.verifyEmailCode(EMAIL, '000000')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(codeTable.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { attempts: { increment: 1 } },
      });
      expect(users.createWithEmail).not.toHaveBeenCalled();
    });

    it('rejects when the attempt limit is reached', async () => {
      codeTable.findFirst.mockResolvedValue({ ...outstanding, attempts: 5 });

      await expect(service.verifyEmailCode(EMAIL, '123456')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(passwords.verify).not.toHaveBeenCalled();
    });

    it('rejects when there is no live code', async () => {
      codeTable.findFirst.mockResolvedValue(null);

      await expect(service.verifyEmailCode(EMAIL, '123456')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('phone sign-in shares the same code handling', () => {
    const PHONE = '+971501234567';

    it('texts a code and creates nothing', async () => {
      await service.requestPhoneCode(PHONE);

      expect(sms.sendVerificationCode).toHaveBeenCalledWith(PHONE, expect.stringMatching(/^\d{6}$/));
      expect(users.createWithPhone).not.toHaveBeenCalled();
    });

    it('rate-limits a repeat text inside the cooldown', async () => {
      codeTable.findFirst.mockResolvedValue({ createdAt: new Date() });

      await expect(service.requestPhoneCode(PHONE)).rejects.toBeInstanceOf(TooManyRequestsException);
      expect(sms.sendVerificationCode).not.toHaveBeenCalled();
    });

    it('creates the account for a new number and flags it as new', async () => {
      codeTable.findFirst.mockResolvedValue({ id: 'c1', codeHash: 'hashed', attempts: 0 });
      passwords.verify.mockResolvedValue(true);
      users.findByPhone.mockResolvedValue(null);
      users.createWithPhone.mockResolvedValue({ id: 'u1' });

      const result = await service.verifyPhoneCode(PHONE, '123456', UserType.BRAND_USER);

      expect(users.createWithPhone).toHaveBeenCalledWith({ phone: PHONE, type: UserType.BRAND_USER });
      expect(result).toEqual({ ...TOKENS, isNewUser: true });
    });

    it('rejects a wrong code without creating anything', async () => {
      codeTable.findFirst.mockResolvedValue({ id: 'c1', codeHash: 'hashed', attempts: 0 });
      passwords.verify.mockResolvedValue(false);

      await expect(service.verifyPhoneCode(PHONE, '000000')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(users.createWithPhone).not.toHaveBeenCalled();
    });
  });
});
