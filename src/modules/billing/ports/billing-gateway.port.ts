export const BILLING_GATEWAY = 'BillingGatewayPort';

export interface SubscriptionCheckoutInput {
  organizationId: string;
  planKey: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
}

export type BillingEvent =
  | { kind: 'SUBSCRIPTION_ACTIVATED'; organizationId: string; stripeSubscriptionId: string }
  | { kind: 'SUBSCRIPTION_CANCELED'; stripeSubscriptionId: string }
  | { kind: 'IGNORED' };

export interface BillingGatewayPort {
  createSubscriptionCheckout(input: SubscriptionCheckoutInput): Promise<{ url: string }>;
  parseWebhookEvent(payload: Buffer, signature: string): BillingEvent;
}
