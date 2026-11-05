export const BILLING_GATEWAY = 'BillingGatewayPort';

export interface SubscriptionCheckoutInput {
  organizationId: string;
  planKey: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
}

export interface CardSetupCheckoutInput {
  organizationId: string;
  successUrl: string;
  cancelUrl: string;
}

export type BillingEvent =
  | { kind: 'SUBSCRIPTION_ACTIVATED'; organizationId: string; stripeSubscriptionId: string }
  | { kind: 'CARD_SAVED'; organizationId: string; setupIntentId: string }
  | { kind: 'SUBSCRIPTION_CANCELED'; stripeSubscriptionId: string }
  | { kind: 'IGNORED' };

export interface BillingGatewayPort {
  createSubscriptionCheckout(input: SubscriptionCheckoutInput): Promise<{ url: string }>;
  /** Moves a live subscription to another price; Stripe prorates the difference. */
  changeSubscriptionPrice(stripeSubscriptionId: string, priceId: string): Promise<void>;
  /** Ends the subscription when the paid period runs out; returns that date. */
  cancelAtPeriodEnd(stripeSubscriptionId: string): Promise<Date>;
  /** Undoes a scheduled cancellation, so the subscription renews as before. */
  resume(stripeSubscriptionId: string): Promise<void>;
  /** Hosted page where the brand enters a card; the card never reaches our servers. */
  createCardSetupCheckout(input: CardSetupCheckoutInput): Promise<{ url: string }>;
  /** Display details of the card saved by a completed setup. */
  describeSavedCard(setupIntentId: string): Promise<{ brand: string | null; last4: string }>;
  parseWebhookEvent(payload: Buffer, signature: string): BillingEvent;
}
