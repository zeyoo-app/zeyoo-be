import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '@platform/config/env.schema';
import { Mailer } from './mailer';

const PLUNK_SEND_ENDPOINT = 'https://next-api.useplunk.com/v1/send';

/** Plunk returns `{ success, data }` or `{ success: false, error: { code, message } }`. */
interface PlunkResponse {
  success?: boolean;
  error?: { code?: string; message?: string };
}

/**
 * Plunk adapter for the {@link Mailer} port.
 *
 * Calls the public send endpoint directly rather than adding the Plunk SDK: the
 * request is a single JSON POST with a bearer token, so a client library would be
 * a dependency for no behavioural gain. Keeps the same shape as TwilioSmsSender so
 * the two providers read alike; swap it out (via MAIL_PROVIDER) to move on.
 *
 * The sender domain must be verified in the Plunk project, otherwise Plunk rejects
 * the send and the recipient's code never arrives.
 */
@Injectable()
export class PlunkMailer extends Mailer {
  private readonly logger = new Logger(PlunkMailer.name);

  constructor(private readonly config: ConfigService<Env, true>) {
    super();
  }

  async sendEmailVerificationCode(to: string, code: string): Promise<void> {
    await this.send({
      to,
      subject: 'Your Zeyoo verification code',
      body: codeBody(
        'Confirm your email address to finish signing up to Zeyoo.',
        code,
      ),
    });
  }

  async sendPasswordResetCode(to: string, code: string): Promise<void> {
    await this.send({
      to,
      subject: 'Reset your Zeyoo password',
      body: codeBody(
        'Use this code to choose a new password for your Zeyoo account.',
        code,
      ),
    });
  }

  async sendLoginCode(to: string, code: string): Promise<void> {
    await this.send({
      to,
      subject: 'Your Zeyoo sign-in code',
      body: codeBody('Use this code to sign in to your Zeyoo account.', code),
    });
  }

  /**
   * The code is the entire payload, so it is set in the email's own text rather
   * than a template. No unsubscribe link: this is transactional mail triggered by
   * the recipient's own request, and Plunk derives a plain-text alternative from
   * the HTML so both parts carry the code.
   */
  private async send(message: { to: string; subject: string; body: string }): Promise<void> {
    const apiKey = this.config.get('PLUNK_API_KEY', { infer: true });
    if (!apiKey) {
      throw new ServiceUnavailableException('Email delivery is not configured.');
    }

    const from = this.sender();
    const response = await fetch(PLUNK_SEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: message.to,
        subject: message.subject,
        body: message.body,
        from,
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as PlunkResponse;

    // Plunk signals application-level failures in the body with HTTP 200, so the
    // status alone is not enough to know the message went out.
    if (!response.ok || payload.success === false) {
      // Plunk's error message can quote the recipient, so it is withheld. Its error
      // code alone is not enough either: an unverified sender domain surfaces as
      // INTERNAL_SERVER_ERROR with the diagnosis only in the message. Logging the
      // sender domain keeps an unverified-domain misconfiguration identifiable from
      // the log alone; that address is a company role address from the deployment's
      // own env, not recipient PII.
      this.logger.error(
        `Plunk rejected the email (status=${response.status}` +
          `${payload.error?.code ? ` code=${payload.error.code}` : ''}` +
          ` senderDomain=${domainOf(from.email)}); recipient withheld.`,
      );
      throw new ServiceUnavailableException('Could not send a verification code. Try again shortly.');
    }
  }

  /**
   * MAIL_FROM accepts both a bare address and RFC 5322 display-name form; Plunk
   * takes them as separate fields, so the name is split out when present.
   */
  private sender(): { name?: string; email: string } {
    const configured = this.config.get('MAIL_FROM', { infer: true }).trim();
    const match = /^(.*?)<([^>]+)>$/.exec(configured);
    if (!match) return { email: configured };
    const [, name, email] = match;
    return { name: name.trim(), email: email.trim() };
  }
}

/** The part of an address after the @, for log lines. Falls back to the whole value. */
function domainOf(address: string): string {
  return address.slice(address.indexOf('@') + 1) || address;
}

/** Shared layout for both code emails — deliberately plain and unstyled. */function codeBody(leadIn: string, code: string): string {
  return [
    `<p>${leadIn}</p>`,
    `<p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:24px 0">${code}</p>`,
    '<p style="color:#666">This code expires in 10 minutes.</p>',
    '<p style="color:#666">If you did not request this, you can safely ignore this email.</p>',
  ].join('');
}
