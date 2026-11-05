import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { Env } from '@platform/config/env.schema';
import { PrismaService } from '@platform/database/prisma.service';
import { AppPaths, returnUrl, type ReturnClient } from '@platform/links';
import { OrganizationService } from '@modules/iam/iam.public';
import { Money } from '../domain/money';
import { PAYMENT_GATEWAY, PaymentGatewayPort } from '../domain/ports/payment-gateway.port';
import { MAX_TOP_UP_MINOR, MIN_TOP_UP_MINOR, WALLET_CURRENCY } from '../domain/wallet';
import { LedgerService } from './ledger.service';

export interface TopUpCreated {
  topUpId: string;
  amountMinor: number;
  currencyCode: string;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  /** Stripe's hosted payment page; null when the payment settled without it. */
  checkoutUrl: string | null;
}

/** Adds money to a brand's wallet by card, through Stripe Checkout. */
@Injectable()
export class TopUpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizations: OrganizationService,
    private readonly ledger: LedgerService,
    private readonly config: ConfigService<Env, true>,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGatewayPort,
  ) {}

  async create(
    organizationId: string,
    requesterId: string,
    amountMinor: number,
    client: ReturnClient,
  ): Promise<TopUpCreated> {
    if (!Number.isInteger(amountMinor) || amountMinor < MIN_TOP_UP_MINOR) {
      throw new BadRequestException(`The minimum top-up is $${MIN_TOP_UP_MINOR / 100}.`);
    }
    if (amountMinor > MAX_TOP_UP_MINOR) {
      throw new BadRequestException(
        `A single top-up can be at most $${(MAX_TOP_UP_MINOR / 100).toLocaleString('en-US')}.`,
      );
    }
    await this.organizations.assertMember(organizationId, requesterId);

    const base = this.config.get('APP_WEB_URL', { infer: true });
    const bypassStripe = this.config.get('PAYMENTS_BYPASS_STRIPE', { infer: true });
    const checkout = bypassStripe
      ? { reference: `bypass_${randomUUID()}`, url: null }
      : await this.gateway.createFundingCheckout({
          amountMinor,
          feeMinor: 0,
          feeLabel: '',
          currencyCode: WALLET_CURRENCY,
          title: 'Zeyoo wallet top-up',
          successUrl: returnUrl(base, `${AppPaths.brandWallet}?topup=success`, client),
          cancelUrl: returnUrl(base, `${AppPaths.brandWallet}?topup=cancelled`, client),
          metadata: { organizationId, purpose: 'wallet_top_up' },
        });
    const topUp = await this.prisma.walletTopUp.create({
      data: {
        organizationId,
        amount: amountMinor,
        currencyCode: WALLET_CURRENCY,
        stripeCheckoutId: checkout.reference,
        createdByUserId: requesterId,
      },
      select: { id: true },
    });
    if (bypassStripe) {
      await this.markSucceeded(checkout.reference);
    }
    return {
      topUpId: topUp.id,
      amountMinor,
      currencyCode: WALLET_CURRENCY,
      status: bypassStripe ? 'SUCCEEDED' : 'PENDING',
      checkoutUrl: checkout.url,
    };
  }

  /**
   * Stripe confirmed a payment. A no-op for references that are not top-ups (the same
   * webhook carries campaign payments) and for top-ups already credited.
   */
  async markSucceeded(reference: string): Promise<void> {
    const transitioned = await this.prisma.walletTopUp.updateMany({
      where: { stripeCheckoutId: reference, status: 'PENDING' },
      data: { status: 'SUCCEEDED' },
    });
    if (transitioned.count === 0) return;
    const topUp = await this.prisma.walletTopUp.findUniqueOrThrow({
      where: { stripeCheckoutId: reference },
    });
    await this.ledger.recordTopUp(
      topUp.organizationId,
      Money.of(topUp.amount, topUp.currencyCode),
      topUp.id,
    );
  }

  async markFailed(reference: string): Promise<void> {
    await this.prisma.walletTopUp.updateMany({
      where: { stripeCheckoutId: reference, status: 'PENDING' },
      data: { status: 'FAILED' },
    });
  }
}
