import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { validateEnv } from '@platform/config/env.schema';
import { LogMailer } from './log.mailer';
import { Mailer } from './mailer';
import { MailModule } from './mail.module';
import { PlunkMailer } from './plunk.mailer';

/** Everything the env schema demands regardless of which adapter is under test. */
const BASE_ENV: Record<string, string> = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/zeyoo_test',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'test-access-secret-value',
  JWT_REFRESH_SECRET: 'test-refresh-secret-value',
  STRIPE_SECRET_KEY: 'sk_test_dummy',
  STRIPE_WEBHOOK_SECRET: 'whsec_dummy',
  R2_ACCOUNT_ID: 'test-account',
  R2_ACCESS_KEY_ID: 'test-key',
  R2_SECRET_ACCESS_KEY: 'test-secret',
  R2_BUCKET: 'test-bucket',
  PUBLIC_ASSET_BASE_URL: 'https://cdn.test',
};

const TOUCHED_KEYS = [...Object.keys(BASE_ENV), 'NODE_ENV', 'MAIL_PROVIDER', 'PLUNK_API_KEY'];

/**
 * Verification codes and reset codes are bearer credentials for the account they
 * were sent to, so the adapter binding is security-sensitive: these pin the cases
 * where a deployment must refuse to start rather than quietly log codes or 503
 * later. Deliberately parallel to sms.module.spec.ts.
 */
describe('MailModule provider binding', () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(TOUCHED_KEYS.map((key) => [key, process.env[key]]));
    for (const key of TOUCHED_KEYS) delete process.env[key];
    Object.assign(process.env, BASE_ENV);
  });

  afterEach(() => {
    for (const key of TOUCHED_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  async function resolve(env: Record<string, string>): Promise<Mailer> {
    Object.assign(process.env, env);
    const moduleRef = await Test.createTestingModule({
      imports: [
        // ignoreEnvFile keeps a developer's local .env from deciding these outcomes.
        ConfigModule.forRoot({
          isGlobal: true,
          cache: true,
          validate: validateEnv,
          ignoreEnvFile: true,
        }),
        MailModule,
      ],
    }).compile();
    return moduleRef.get(Mailer);
  }

  it('prefers Plunk under `auto` when an API key is present', async () => {
    await expect(resolve({ PLUNK_API_KEY: 'sk_test_key' })).resolves.toBeInstanceOf(PlunkMailer);
  });

  it('falls back to the log adapter under `auto` outside production', async () => {
    await expect(resolve({ NODE_ENV: 'development' })).resolves.toBeInstanceOf(LogMailer);
  });

  it('refuses to start in production when `auto` finds no API key', async () => {
    await expect(resolve({ NODE_ENV: 'production' })).rejects.toThrow(/Refusing to start/i);
  });

  it('refuses the log adapter in production even when asked for explicitly', async () => {
    await expect(resolve({ NODE_ENV: 'production', MAIL_PROVIDER: 'log' })).rejects.toThrow(
      /Refusing to start/i,
    );
  });

  it('refuses `plunk` without an API key, rather than failing on first send', async () => {
    await expect(resolve({ NODE_ENV: 'production', MAIL_PROVIDER: 'plunk' })).rejects.toThrow(
      /PLUNK_API_KEY/,
    );
  });
});
