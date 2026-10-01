import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '@platform/config/env.schema';
import { LogMailer } from './log.mailer';
import { Mailer } from './mailer';
import { PlunkMailer } from './plunk.mailer';

/**
 * Binds the {@link Mailer} port. MAIL_PROVIDER picks the adapter; `auto` (the
 * default) uses Plunk when its API key is present and otherwise falls back to the
 * log adapter so local development needs no provider account.
 *
 * A verification code must never reach the log in production, so the log adapter
 * is refused outright there — whether it was chosen explicitly or arrived by
 * `auto` fallback. Failing at boot beats silently logging every code. This is the
 * same contract as SmsModule, deliberately.
 */
@Global()
@Module({
  providers: [
    LogMailer,
    PlunkMailer,
    {
      provide: Mailer,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): Mailer => {
        const requested = config.get('MAIL_PROVIDER', { infer: true });
        const apiKey = config.get('PLUNK_API_KEY', { infer: true });

        if (requested === 'plunk' && !apiKey) {
          throw new Error('MAIL_PROVIDER=plunk but PLUNK_API_KEY is not set. Refusing to start.');
        }

        const mailer: Mailer =
          requested === 'plunk' || (requested === 'auto' && apiKey)
            ? new PlunkMailer(config)
            : new LogMailer();

        if (mailer instanceof LogMailer && config.get('NODE_ENV', { infer: true }) === 'production') {
          throw new Error(
            `Refusing to start in production with the log mail adapter (MAIL_PROVIDER=${requested}). ` +
              'Set MAIL_PROVIDER=plunk and provide PLUNK_API_KEY.',
          );
        }
        return mailer;
      },
    },
  ],
  exports: [Mailer],
})
export class MailModule {}
