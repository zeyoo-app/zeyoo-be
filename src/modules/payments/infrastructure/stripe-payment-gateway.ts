import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { Env } from '@platform/config/env.schema';
import {
  CreateFundingIntentInput,
  CreatePayoutInput,
  FundingIntent,
  GatewayEvent,
  PaymentGatewayPort,
} from '../domain/ports/payment-gateway.port';

@Injectable()
export class StripePaymentGateway implements PaymentGatewayPort {
  private readonly stripe: Stripe;
  private readonly webhookSecret: string;

  constructor(config: ConfigService<Env, true>) {
    this.stripe = new Stripe(config.get('STRIPE_SECRET_KEY', { infer: true }));
    this.webhookSecret = config.get('STRIPE_WEBHOOK_SECRET', { infer: true });
  }

  async createFundingIntent(input: CreateFundingIntentInput): Promise<FundingIntent> {
    const intent = await this.stripe.paymentIntents.create({
      amount: input.amountMinor,
      currency: input.currencyCode.toLowerCase(),
      metadata: input.metadata,
    });
    if (!intent.client_secret) {
      throw new Error('Stripe did not return a client secret for the payment intent.');
    }
    return { intentId: intent.id, clientSecret: intent.client_secret };
  }

  async createPayout(input: CreatePayoutInput): Promise<{ payoutId: string }> {
    const transfer = await this.stripe.transfers.create({
      amount: input.amountMinor,
      currency: input.currencyCode.toLowerCase(),
      destination: input.destinationAccountId,
      metadata: input.metadata,
    });
    return { payoutId: transfer.id };
  }

  parseWebhookEvent(payload: Buffer, signature: string): GatewayEvent {
    const event = this.stripe.webhooks.constructEvent(payload, signature, this.webhookSecret);
    if (event.type === 'payment_intent.succeeded') {
      return { kind: 'FUNDING_SUCCEEDED', intentId: this.intentIdOf(event) };
    }
    if (event.type === 'payment_intent.payment_failed') {
      return { kind: 'FUNDING_FAILED', intentId: this.intentIdOf(event) };
    }
    return { kind: 'IGNORED' };
  }

  private intentIdOf(event: Stripe.Event): string {
    return (event.data.object as Stripe.PaymentIntent).id;
  }
}
