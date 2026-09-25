/**
 * Transactional-email port. Higher layers depend on this abstract class, never
 * on a concrete provider, so the delivery backend (SES / Resend / SMTP) can be
 * swapped without touching callers. The dev/default binding is {@link LogMailer}.
 */
export abstract class Mailer {
  abstract sendEmailVerificationCode(to: string, code: string): Promise<void>;
  abstract sendPasswordResetCode(to: string, code: string): Promise<void>;
}
