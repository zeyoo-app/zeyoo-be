import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '@platform/config/env.schema';
import { SmsSender } from './sms.sender';

const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01';

/**
 * Twilio adapter for the {@link SmsSender} port.
 *
 * Calls the Messages REST endpoint directly rather than pulling in the Twilio
 * SDK: the request is a single form-encoded POST with basic auth, so the official
 * client would add a large dependency for no behavioural gain. Swap this class
 * out (via SMS_PROVIDER) to move to another aggregator.
 */
@Injectable()
export class TwilioSmsSender extends SmsSender {
  private readonly logger = new Logger(TwilioSmsSender.name);

  constructor(private readonly config: ConfigService<Env, true>) {
    super();
  }

  async sendVerificationCode(to: string, code: string): Promise<void> {
    const accountSid = this.config.get('TWILIO_ACCOUNT_SID', { infer: true });
    const authToken = this.config.get('TWILIO_AUTH_TOKEN', { infer: true });
    const from = this.config.get('TWILIO_FROM_NUMBER', { infer: true });
    if (!accountSid || !authToken || !from) {
      throw new ServiceUnavailableException('SMS delivery is not configured.');
    }

    const response = await fetch(`${TWILIO_API_BASE}/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        To: to,
        From: from,
        Body: `${code} is your Zeyoo verification code. It expires in 10 minutes.`,
      }),
    });

    if (!response.ok) {
      // Twilio's error body echoes the account SID and the destination number, and
      // the SID is already in the request URL, so the body must not be logged. Only
      // the numeric error code is safe and it is enough to tell a bad number
      // (21211) from an unreachable one (21614) from a carrier rejection.
      const code = await this.errorCode(response);
      this.logger.error(
        `Twilio rejected the message (status=${response.status}${code ? ` code=${code}` : ''}); destination withheld.`,
      );
      throw new ServiceUnavailableException('Could not send a verification code. Try again shortly.');
    }
  }

  /** Twilio's numeric error code, if the body parses as JSON. Never logs the body. */
  private async errorCode(response: Response): Promise<number | null> {
    const body = (await response.json().catch(() => null)) as { code?: unknown } | null;
    return typeof body?.code === 'number' ? body.code : null;
  }
}
