export const PAYMENT_GATEWAY = 'PaymentGatewayPort';

export interface CreateFundingIntentInput {
  amountMinor: number;
  currencyCode: string;
  metadata: Record<string, string>;
}

export interface FundingIntent {
  intentId: string;
  clientSecret: string;
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
  returnUrl: string;
  refreshUrl: string;
  metadata: Record<string, string>;
}

/** A gateway event normalized to what the payments module reacts to. */
export type GatewayEvent =
  | { kind: 'FUNDING_SUCCEEDED'; intentId: string }
  | { kind: 'FUNDING_FAILED'; intentId: string }
  | { kind: 'IGNORED' };

/**
 * Outbound port for the payment provider. The domain depends on this interface;
 * the Stripe adapter (or any test double) implements it.
 */
export interface PaymentGatewayPort {
  createFundingIntent(input: CreateFundingIntentInput): Promise<FundingIntent>;
  createPayout(input: CreatePayoutInput): Promise<{ payoutId: string }>;
  /** Creates (or resumes) a connected payout account and returns its hosted onboarding URL. */
  createPayoutOnboarding(input: PayoutOnboardingInput): Promise<{ accountId: string; url: string }>;
  /** True once the connected account can receive payouts. */
  isPayoutAccountReady(accountId: string): Promise<boolean>;
  parseWebhookEvent(payload: Buffer, signature: string): GatewayEvent;
}
