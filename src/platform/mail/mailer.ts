import type { EmailAction } from './email-layout';

/**
 * Transactional-email port. Higher layers depend on this abstract class, never
 * on a concrete provider, so the delivery backend (SES / Resend / SMTP) can be
 * swapped without touching callers. The dev/default binding is {@link LogMailer}.
 */
export abstract class Mailer {
  abstract sendSignInCode(to: string, code: string): Promise<void>;
  /**
   * A notification email (an application decision, a payout update, a dispute reply).
   * `action` adds a button to the page it is about; its URL opens the app when installed.
   */
  abstract sendNotification(
    to: string,
    subject: string,
    body: string,
    action?: EmailAction,
  ): Promise<void>;
}
