import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { Env } from '@platform/config/env.schema';
import {
  BillingEvent,
  BillingGatewayPort,
  SubscriptionCheckoutInput,
} from '../ports/billing-gateway.port';

@Injectable()
export class StripeBillingGateway implements BillingGatewayPort {
  private readonly stripe: Stripe;
  private readonly webhookSecret: string;

  constructor(config: ConfigService<Env, true>) {
    this.stripe = new Stripe(config.get('STRIPE_SECRET_KEY', { infer: true }));
    this.webhookSecret = config.get('STRIPE_WEBHOOK_SECRET', { infer: true });
  }

  async createSubscriptionCheckout(input: SubscriptionCheckoutInput): Promise<{ url: string }> {
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: input.priceId, quantity: 1 }],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      metadata: { organizationId: input.organizationId, planKey: input.planKey },
    });
    if (!session.url) {
      throw new Error('Stripe did not return a checkout URL.');
    }
    return { url: session.url };
  }

  parseWebhookEvent(payload: Buffer, signature: string): BillingEvent {
    const event = this.stripe.webhooks.constructEvent(payload, signature, this.webhookSecret);
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      return {
        kind: 'SUBSCRIPTION_ACTIVATED',
        organizationId: session.metadata?.organizationId ?? '',
        stripeSubscriptionId: String(session.subscription),
      };
    }
    if (event.type === 'customer.subscription.deleted') {
      return {
        kind: 'SUBSCRIPTION_CANCELED',
        stripeSubscriptionId: (event.data.object as Stripe.Subscription).id,
      };
    }
    return { kind: 'IGNORED' };
  }
}
