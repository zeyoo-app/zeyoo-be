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
  /** Hosted page where the brand enters a card; the card never reaches our servers. */
  createCardSetupCheckout(input: CardSetupCheckoutInput): Promise<{ url: string }>;
  /** Display details of the card saved by a completed setup. */
  describeSavedCard(setupIntentId: string): Promise<{ brand: string | null; last4: string }>;
  parseWebhookEvent(payload: Buffer, signature: string): BillingEvent;
}
