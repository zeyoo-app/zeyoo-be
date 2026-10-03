import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { validateEnv } from '@platform/config/env.schema';
import { LogSmsSender } from './log-sms.sender';
import { SmsSender } from './sms.sender';
import { SmsModule } from './sms.module';
import { TwilioSmsSender } from './twilio-sms.sender';

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

const TWILIO_ENV: Record<string, string> = {
  TWILIO_ACCOUNT_SID: 'ACdummy',
  TWILIO_AUTH_TOKEN: 'auth-token-dummy',
  TWILIO_FROM_NUMBER: '+15550000000',
};

const TOUCHED_KEYS = [
  ...Object.keys(BASE_ENV),
  ...Object.keys(TWILIO_ENV),
  'NODE_ENV',
  'SMS_PROVIDER',
];

/**
 * A verification code is a bearer credential for the account it was sent to, so the
 * adapter binding itself is security-sensitive: these tests pin the cases where a
 * deployment must refuse to start rather than quietly log codes or 503 later.
 */
describe('SmsModule provider binding', () => {
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

  async function resolve(env: Record<string, string>): Promise<SmsSender> {
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
        SmsModule,
      ],
    }).compile();
    return moduleRef.get(SmsSender);
  }

  it('prefers Twilio under `auto` when all credentials are present', async () => {
    await expect(resolve({ ...TWILIO_ENV })).resolves.toBeInstanceOf(TwilioSmsSender);
  });

  it('falls back to the log adapter under `auto` outside production', async () => {
    await expect(resolve({ NODE_ENV: 'development' })).resolves.toBeInstanceOf(LogSmsSender);
  });

  it('refuses to start in production when `auto` finds no credentials', async () => {
    await expect(resolve({ NODE_ENV: 'production' })).rejects.toThrow(/Refusing to start/i);
  });

  it('refuses the log adapter in production even when asked for explicitly', async () => {
    await expect(resolve({ NODE_ENV: 'production', SMS_PROVIDER: 'log' })).rejects.toThrow(
      /Refusing to start/i,
    );
  });

  it('refuses `twilio` when credentials are incomplete, rather than failing on first send', async () => {
    await expect(
      resolve({ NODE_ENV: 'production', SMS_PROVIDER: 'twilio', TWILIO_ACCOUNT_SID: 'ACdummy' }),
    ).rejects.toThrow(/TWILIO_FROM_NUMBER/);
  });
});
