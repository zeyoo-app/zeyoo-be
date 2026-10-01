/**
 * Transactional-SMS port. Higher layers depend on this abstract class, never on
 * a concrete provider, so the delivery backend (Twilio / MessageBird / a local
 * emulator) can be swapped without touching callers. The development binding is
 * {@link LogSmsSender}.
 */
export abstract class SmsSender {
  abstract sendVerificationCode(to: string, code: string): Promise<void>;
}
