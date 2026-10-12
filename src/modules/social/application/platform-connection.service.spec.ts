import { randomBytes } from 'crypto';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { PlatformConnectionService } from './platform-connection.service';

const KEY = randomBytes(32).toString('base64');

const CONFIG_VALUES: Record<string, string | undefined> = {
  SOCIAL_TOKEN_ENCRYPTION_KEY: KEY,
  TIKTOK_CLIENT_KEY: 'client-key',
  TIKTOK_CLIENT_SECRET: 'client-secret',
  SOCIAL_OAUTH_REDIRECT_URI: 'https://www.zeyoo.app/connect/callback',
};

function build(overrides: Record<string, string | undefined> = {}): {
  service: PlatformConnectionService;
  upsert: jest.Mock;
  exchangeCode: jest.Mock;
  connectVerified: jest.Mock;
} {
  const values = { ...CONFIG_VALUES, ...overrides };
  const upsert = jest.fn().mockResolvedValue(undefined);
  const connectVerified = jest.fn().mockResolvedValue(undefined);
  const exchangeCode = jest.fn().mockResolvedValue({
    accessToken: 'access',
    refreshToken: 'refresh',
    expiresAt: null,
    externalAccountId: 'open-id',
  });
  const provider = {
    platform: 'TIKTOK',
    authorizationUrl: jest
      .fn()
      .mockImplementation((_app, state: string) => `https://auth.test/?state=${state}`),
    exchangeCode,
    describeAccount: jest
      .fn()
      .mockResolvedValue({ externalAccountId: 'open-id', handle: 'creator' }),
    refresh: jest.fn(),
  };
  const service = new PlatformConnectionService(
    { socialOAuthToken: { upsert } } as never,
    { get: (key: string) => values[key] } as never,
    jest.fn() as never,
    [provider] as never,
    { connectVerified } as never,
  );
  return { service, upsert, exchangeCode, connectVerified };
}

const stateOf = (authorizationUrl: string): string =>
  decodeURIComponent(authorizationUrl.split('state=')[1]);

describe('PlatformConnectionService', () => {
  it('completes a connection started by the same creator and stores encrypted tokens', async () => {
    const { service, upsert, connectVerified } = build();
    const { authorizationUrl } = service.startConnection('TIKTOK', 'creator-1', 'app');

    const account = await service.completeConnection(
      'creator-1',
      'auth-code',
      stateOf(authorizationUrl),
    );

    expect(account).toMatchObject({ platform: 'TIKTOK', handle: 'creator' });
    const stored = upsert.mock.calls[0][0].create;
    expect(stored.accessTokenEncrypted).not.toContain('access');
    expect(stored.externalAccountId).toBe('open-id');
    expect(connectVerified).toHaveBeenCalledWith('creator-1', {
      platform: 'TIKTOK',
      handle: 'creator',
      platformAccountId: 'open-id',
    });
  });

  it('rejects a callback whose state was issued to a different creator', async () => {
    const { service, exchangeCode } = build();
    const { authorizationUrl } = service.startConnection('TIKTOK', 'creator-1', 'web');

    await expect(
      service.completeConnection('creator-2', 'auth-code', stateOf(authorizationUrl)),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it('rejects a forged or tampered state', async () => {
    const { service } = build();

    await expect(
      service.completeConnection('creator-1', 'code', 'forged.state'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('is unavailable until the platform app credentials are configured', () => {
    const { service } = build({ TIKTOK_CLIENT_SECRET: undefined });

    expect(() => service.startConnection('TIKTOK', 'creator-1', 'web')).toThrow(
      ServiceUnavailableException,
    );
  });
});
