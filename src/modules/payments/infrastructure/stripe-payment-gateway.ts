import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { Env } from '@platform/config/env.schema';
import {
  CreateFundingCheckoutInput,
  CreatePayoutInput,
  FundingCheckout,
  RefundPaymentInput,
  GatewayEvent,
  PaymentGatewayPort,
  PayoutOnboardingInput,
} from '../domain/ports/payment-gateway.port';

/** Accounts v2 is only served on dated API versions that include it. */
const ACCOUNTS_V2_API_VERSION = '2026-09-30.endive';

interface RecipientAccount {
  configuration?: {
    recipient?: {
      capabilities?: { stripe_balance?: { stripe_transfers?: { status?: string } } };
    };
  };
}

@Injectable()
export class StripePaymentGateway implements PaymentGatewayPort {
  private readonly stripe: Stripe;
  private readonly webhookSecret: string;

  constructor(config: ConfigService<Env, true>) {
    this.stripe = new Stripe(config.get('STRIPE_SECRET_KEY', { infer: true }));
    this.webhookSecret = config.get('STRIPE_WEBHOOK_SECRET', { infer: true });
  }

  async createFundingCheckout(input: CreateFundingCheckoutInput): Promise<FundingCheckout> {
    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: input.currencyCode.toLowerCase(),
            unit_amount: input.amountMinor,
            product_data: { name: input.title },
          },
        },
      ],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      metadata: input.metadata,
    });
    if (!session.url) {
      throw new Error('Stripe did not return a checkout URL.');
    }
    return { reference: session.id, url: session.url };
  }

  async refundPayment(input: RefundPaymentInput): Promise<{ refundId: string }> {
    const session = await this.stripe.checkout.sessions.retrieve(input.reference);
    const paymentIntent =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id;
    if (!paymentIntent) {
      throw new Error('This checkout has no payment to refund.');
    }
    const refund = await this.stripe.refunds.create(
      { payment_intent: paymentIntent, amount: input.amountMinor },
      { idempotencyKey: input.idempotencyKey },
    );
    return { refundId: refund.id };
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

  async createPayoutOnboarding(
    input: PayoutOnboardingInput,
  ): Promise<{ accountId: string; url: string }> {
    const accountId = input.existingAccountId ?? (await this.createRecipientAccount(input));
    const link = (await this.v2('POST', '/v2/core/account_links', {
      account: accountId,
      use_case: {
        type: 'account_onboarding',
        account_onboarding: {
          return_url: input.returnUrl,
          refresh_url: input.refreshUrl,
        },
      },
    })) as { url: string };
    return { accountId, url: link.url };
  }

  async isPayoutAccountReady(accountId: string): Promise<boolean> {
    const account = (await this.v2(
      'GET',
      `/v2/core/accounts/${accountId}?include[0]=configuration.recipient`,
    )) as RecipientAccount;
    const transfers =
      account.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers;
    return transfers?.status === 'active';
  }

  private async createRecipientAccount(input: PayoutOnboardingInput): Promise<string> {
    const account = (await this.v2('POST', '/v2/core/accounts', {
      contact_email: input.email ?? undefined,
      display_name: input.displayName,
      identity: { country: input.country },
      dashboard: 'express',
      defaults: {
        responsibilities: { fees_collector: 'application', losses_collector: 'application' },
      },
      configuration: {
        recipient: {
          capabilities: { stripe_balance: { stripe_transfers: { requested: true } } },
        },
      },
      metadata: input.metadata,
    })) as { id: string };
    return account.id;
  }

  private async v2(method: 'GET' | 'POST', path: string, params?: object): Promise<unknown> {
    const response = await this.stripe.rawRequest(method, path, params as never, {
      apiVersion: ACCOUNTS_V2_API_VERSION,
    });
    return response;
  }

  parseWebhookEvent(payload: Buffer, signature: string): GatewayEvent {
    const event = this.stripe.webhooks.constructEvent(payload, signature, this.webhookSecret);
    if (!event.type.startsWith('checkout.session.')) {
      return { kind: 'IGNORED' };
    }
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.mode !== 'payment') {
      return { kind: 'IGNORED' };
    }
    const paid =
      event.type === 'checkout.session.async_payment_succeeded' ||
      (event.type === 'checkout.session.completed' && session.payment_status === 'paid');
    if (paid) {
      return { kind: 'FUNDING_SUCCEEDED', reference: session.id };
    }
    const failed =
      event.type === 'checkout.session.expired' ||
      event.type === 'checkout.session.async_payment_failed';
    return failed ? { kind: 'FUNDING_FAILED', reference: session.id } : { kind: 'IGNORED' };
  }
}
