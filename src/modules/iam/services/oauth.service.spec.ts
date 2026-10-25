import { ConflictException } from '@nestjs/common';
import { OAuthService } from './oauth.service';

function build(existing: { linked?: object | null; byEmail?: object | null }) {
  const users = {
    findByOAuthIdentity: jest.fn().mockResolvedValue(existing.linked ?? null),
    findByEmail: jest.fn().mockResolvedValue(existing.byEmail ?? null),
    linkOAuthIdentity: jest.fn().mockResolvedValue(undefined),
    createOAuthUser: jest.fn().mockResolvedValue({ id: 'new', status: 'ACTIVE' }),
  };
  const tokens = { issueFor: jest.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }) };
  const verifier = {
    verify: jest
      .fn()
      .mockResolvedValue({ providerUserId: 'g-1', email: 'new@example.com', emailVerified: true }),
  };
  return {
    service: new OAuthService(users as never, tokens as never, verifier as never),
    users,
  };
}

describe('OAuthService.signIn', () => {
  it('asks a brand-new person to choose an account type instead of making them a creator', async () => {
    const { service, users } = build({});

    const error = await service
      .signIn({ provider: 'GOOGLE', idToken: 't' })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: 'ACCOUNT_TYPE_REQUIRED',
    });
    expect(users.createOAuthUser).not.toHaveBeenCalled();
  });

  it('creates the account once the type is chosen', async () => {
    const { service, users } = build({});

    await service.signIn({ provider: 'GOOGLE', idToken: 't', userType: 'BRAND_USER' });

    expect(users.createOAuthUser).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'BRAND_USER' }),
    );
  });

  it('signs a returning person straight in without asking', async () => {
    const { service, users } = build({ linked: { id: 'u1', status: 'ACTIVE' } });

    await expect(service.signIn({ provider: 'GOOGLE', idToken: 't' })).resolves.toBeDefined();
    expect(users.createOAuthUser).not.toHaveBeenCalled();
  });
});
