export const PAYMENT_GATEWAY = 'PaymentGatewayPort';

export interface CreateFundingCheckoutInput {
  amountMinor: number;
  currencyCode: string;
  title: string;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
}

export interface RefundPaymentInput {
  /** The reference stored on the funding row (the Checkout session id). */
  reference: string;
  amountMinor: number;
  /** Retrying with the same key never refunds twice. */
  idempotencyKey: string;
}

export interface FundingCheckout {
  /** Stored on the funding row and echoed back by the webhook to find it again. */
  reference: string;
  url: string;
}

export interface CreatePayoutInput {
  amountMinor: number;
  currencyCode: string;
  destinationAccountId: string;
  metadata: Record<string, string>;
}

export interface PayoutOnboardingInput {
  /** Reuse an existing connected account; omitted for a creator's first attempt. */
  existingAccountId?: string;
  email: string | null;
  displayName: string;
  /** Lower-case ISO country the creator is paid in. */
  country: string;
  returnUrl: string;
  refreshUrl: string;
  metadata: Record<string, string>;
}

/** A gateway event normalized to what the payments module reacts to. */
export type GatewayEvent =
  | { kind: 'FUNDING_SUCCEEDED'; reference: string }
  | { kind: 'FUNDING_FAILED'; reference: string }
  | { kind: 'IGNORED' };

/**
 * Outbound port for the payment provider. The domain depends on this interface;
 * the Stripe adapter (or any test double) implements it.
 */
export interface PaymentGatewayPort {
  createFundingCheckout(input: CreateFundingCheckoutInput): Promise<FundingCheckout>;
  refundPayment(input: RefundPaymentInput): Promise<{ refundId: string }>;
  createPayout(input: CreatePayoutInput): Promise<{ payoutId: string }>;
  /** Creates (or resumes) a connected payout account and returns its hosted onboarding URL. */
  createPayoutOnboarding(input: PayoutOnboardingInput): Promise<{ accountId: string; url: string }>;
  /** True once the connected account can receive payouts. */
  isPayoutAccountReady(accountId: string): Promise<boolean>;
  parseWebhookEvent(payload: Buffer, signature: string): GatewayEvent;
}
