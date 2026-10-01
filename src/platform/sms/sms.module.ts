import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '@platform/config/env.schema';
import { LogSmsSender } from './log-sms.sender';
import { SmsSender } from './sms.sender';
import { TwilioSmsSender } from './twilio-sms.sender';

/** All three are needed before a message can be sent, so `auto` requires all three. */
const TWILIO_KEYS = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER'] as const;

/**
 * Binds the {@link SmsSender} port. SMS_PROVIDER picks the adapter; `auto` (the
 * default) uses Twilio when its credentials are present and otherwise falls back
 * to the log adapter so local development needs no provider account.
 *
 * A verification code must never reach the log in production, so the log adapter
 * is refused outright there — whether it was chosen explicitly or arrived by
 * `auto` fallback. Failing at boot beats silently logging every OTP.
 */
@Global()
@Module({
  providers: [
    LogSmsSender,
    TwilioSmsSender,
    {
      provide: SmsSender,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): SmsSender => {
        const requested = config.get('SMS_PROVIDER', { infer: true });
        const configured = TWILIO_KEYS.every((key) => Boolean(config.get(key, { infer: true })));

        if (requested === 'twilio' && !configured) {
          throw new Error(
            'SMS_PROVIDER=twilio but not all of ' +
              `${TWILIO_KEYS.join(', ')} are set. Refusing to start.`,
          );
        }

        const sender: SmsSender =
          requested === 'twilio' || (requested === 'auto' && configured)
            ? new TwilioSmsSender(config)
            : new LogSmsSender();

        if (sender instanceof LogSmsSender && config.get('NODE_ENV', { infer: true }) === 'production') {
          throw new Error(
            `Refusing to start in production with the log SMS adapter (SMS_PROVIDER=${requested}). ` +
              'Set SMS_PROVIDER=twilio and provide TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER.',
          );
        }
        return sender;
      },
    },
  ],
  exports: [SmsSender],
})
export class SmsModule {}
