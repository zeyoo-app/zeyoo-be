import { z } from 'zod';

const secondsFromString = z.coerce.number().int().positive();

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: secondsFromString.default(900),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_REFRESH_TTL: secondsFromString.default(1_209_600),

  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),

  APP_WEB_URL: z.string().url().default('http://localhost:3000'),
  // Extra browser origins allowed to call the API (comma-separated, e.g. the www
  // and apex web domains). APP_WEB_URL is always allowed.
  CORS_ORIGINS: z.string().default(''),

  // Image uploads (brand logos, campaign covers) are stored in Cloudflare R2.
  // PUBLIC_ASSET_BASE_URL is the bucket's public origin (a custom domain or the
  // r2.dev URL); an object's URL is that base plus its key.
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1),
  PUBLIC_ASSET_BASE_URL: z.string().url(),

  // From-address for transactional email (verification codes, password resets).
  // Accepts a bare address or display-name form; the adapter splits the two.
  MAIL_FROM: z.string().default('Zeyoo <no-reply@zeyoo.app>'),

  // Transactional email delivery for verification codes and password resets.
  // `auto` uses Plunk whenever an API key is present and otherwise falls back to
  // logging codes (fine in development, refused in production). The sender domain
  // in MAIL_FROM must be verified in the Plunk project. Point this at another
  // adapter to migrate.
  MAIL_PROVIDER: z.enum(['auto', 'log', 'plunk']).default('auto'),
  PLUNK_API_KEY: z.string().optional(),

  // SMS delivery for phone-number sign-in. `auto` uses Twilio whenever its
  // credentials are present and otherwise falls back to logging codes (fine in
  // development, never in production). Point this at another adapter to migrate.
  SMS_PROVIDER: z.enum(['auto', 'log', 'twilio']).default('auto'),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),

  // Social sign-in. Comma-separated list of accepted OAuth client IDs (audiences)
  // per provider — one per platform (iOS / Android / web). When a provider's list
  // is empty in production, that provider's endpoint is disabled.
  GOOGLE_OAUTH_CLIENT_IDS: z.string().default(''),
  APPLE_OAUTH_CLIENT_IDS: z.string().default(''),

  // Optional: enables the AI assistant features when present.
  ANTHROPIC_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
