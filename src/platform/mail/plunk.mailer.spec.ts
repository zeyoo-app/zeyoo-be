import { ConfigService } from '@nestjs/config';
import { Env, validateEnv } from '@platform/config/env.schema';
import { PlunkMailer } from './plunk.mailer';

const SEND_URL = 'https://next-api.useplunk.com/v1/send';

/** Enough to satisfy the env schema, so overrides see the same defaults production does. */
const BASE_ENV: Partial<Env> = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/zeyoo_test',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'test-access-secret-value',
  JWT_REFRESH_SECRET: 'test-refresh-secret-value',
  STRIPE_SECRET_KEY: 'sk_test_dummy',
  STRIPE_WEBHOOK_SECRET: 'whsec_dummy',
};

/** Runs overrides through the real schema so the stub cannot drift from production. */
function configWith(overrides: Partial<Env> = {}): ConfigService<Env, true> {
  const env = validateEnv({ ...BASE_ENV, ...overrides });
  return { get: (key: keyof Env) => env[key] } as unknown as ConfigService<Env, true>;
}

/** The JSON body of the nth (only) fetch call, parsed. */
function sentBody(fetchMock: jest.Mock): Record<string, unknown> {
  return JSON.parse(fetchMock.mock.calls[0][1].body as string);
}

function sentHeaders(fetchMock: jest.Mock): Record<string, string> {
  return fetchMock.mock.calls[0][1].headers as Record<string, string>;
}

describe('PlunkMailer', () => {
  let fetchMock: jest.Mock;
  const originalFetch = global.fetch;

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { emailId: 'msg_1' } }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('posts the verification code to Plunk with a bearer token', async () => {
    const mailer = new PlunkMailer(configWith({ PLUNK_API_KEY: 'sk_test_key' }));

    await mailer.sendSignInCode('user@example.com', '123456');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(SEND_URL);
    expect(sentHeaders(fetchMock)).toMatchObject({
      Authorization: 'Bearer sk_test_key',
      'Content-Type': 'application/json',
    });
    expect(sentBody(fetchMock)).toMatchObject({
      to: 'user@example.com',
      subject: 'Your Zeyoo sign-in code',
    });
    expect(sentBody(fetchMock).body as string).toContain('123456');
  });

  it('splits a display-name MAIL_FROM into Plunk name and email fields', async () => {
    const mailer = new PlunkMailer(
      configWith({ PLUNK_API_KEY: 'sk_test_key', MAIL_FROM: 'Zeyoo <no-reply@zeyoo.app>' }),
    );

    await mailer.sendSignInCode('user@example.com', '123456');

    expect(sentBody(fetchMock).from).toEqual({ name: 'Zeyoo', email: 'no-reply@zeyoo.app' });
  });

  it('sends a bare address unchanged', async () => {
    const mailer = new PlunkMailer(
      configWith({ PLUNK_API_KEY: 'sk_test_key', MAIL_FROM: 'no-reply@zeyoo.app' }),
    );

    await mailer.sendSignInCode('user@example.com', '123456');

    expect(sentBody(fetchMock).from).toEqual({ email: 'no-reply@zeyoo.app' });
  });

  it('refuses to send without an API key, without calling Plunk', async () => {
    const mailer = new PlunkMailer(configWith());

    await expect(mailer.sendSignInCode('user@example.com', '123456')).rejects.toThrow(
      /not configured/i,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats a 200 with success:false as a failure — Plunk signals errors in the body', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: false, error: { code: 'DOMAIN_NOT_VERIFIED', message: 'nope' } }),
    });
    const mailer = new PlunkMailer(configWith({ PLUNK_API_KEY: 'sk_test_key' }));

    await expect(mailer.sendSignInCode('user@example.com', '123456')).rejects.toThrow(
      /try again shortly/i,
    );
  });

  it('rejects on a non-2xx response and never surfaces Plunk internals to the caller', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ success: false, error: { code: 'UNAUTHORIZED', message: 'bad key' } }),
    });
    const mailer = new PlunkMailer(configWith({ PLUNK_API_KEY: 'sk_test_key' }));

    const failure = await mailer
      .sendSignInCode('user@example.com', '123456')
      .then(() => null, (error: Error) => error);

    expect(failure?.message).toMatch(/try again shortly/i);
    expect(failure?.message).not.toMatch(/bad key|UNAUTHORIZED|user@example\.com/);
  });

  it('survives a response body that is not JSON', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('not json');
      },
    });
    const mailer = new PlunkMailer(configWith({ PLUNK_API_KEY: 'sk_test_key' }));

    await expect(mailer.sendSignInCode('user@example.com', '123456')).rejects.toThrow(
      /try again shortly/i,
    );
  });

  it('names the sender domain when Plunk reports an unverified domain', async () => {
    // Plunk's actual shape for this case: a generic code, with the diagnosis only
    // in the message. Without the domain in the log line this is undiagnosable.
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Domain "zeyoo.app" is not verified. Please complete the DNS verification process.',
        },
      }),
    });
    const mailer = new PlunkMailer(
      configWith({ PLUNK_API_KEY: 'sk_test_key', MAIL_FROM: 'Zeyoo <no-reply@zeyoo.app>' }),
    );
    // The logger is per-instance, so the spy has to wrap the instance under test.
    const log = jest.spyOn(mailer['logger'], 'error').mockImplementation(() => undefined);

    await expect(mailer.sendSignInCode('user@example.com', '123456')).rejects.toThrow();

    expect(log).toHaveBeenCalled();
    const [line] = log.mock.calls[0];
    expect(String(line)).toContain('senderDomain=zeyoo.app');
    expect(String(line)).toContain('status=403');
    expect(String(line)).not.toContain('user@example.com');
    log.mockRestore();
  });
});
