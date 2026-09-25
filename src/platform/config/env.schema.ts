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

  // From-address for transactional email (verification codes, password resets).
  MAIL_FROM: z.string().default('Zeyoo <no-reply@zeyoo.app>'),

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
