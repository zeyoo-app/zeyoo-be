import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '@platform/database/prisma.service';
import { Env } from '@platform/config/env.schema';
import { AppPaths, appUrl, returnUrl, type ReturnClient } from '@platform/links';
import { CampaignService } from '@modules/campaigns/campaigns.public';
import { EntitlementsService } from '@modules/entitlements/entitlements.public';
import { OrganizationService } from '@modules/iam/iam.public';
import { Money } from '../domain/money';
import { PAYMENT_GATEWAY, PaymentGatewayPort } from '../domain/ports/payment-gateway.port';
import { WALLET_CURRENCY } from '../domain/wallet';
import { KeyedLock } from './keyed-lock';
import { LedgerService } from './ledger.service';

export interface FundingStatus {
  fundingId: string;
  amountMinor: number;
  /** Platform fee paid on top of the budget. */
  feeMinor: number;
  currencyCode: string;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
}

export interface FundingCreated extends FundingStatus {
  /** Stripe's hosted payment page; null when the payment was settled without it. */
  checkoutUrl: string | null;
}

@Injectable()
export class FundingService {
  private readonly walletLock = new KeyedLock();

  constructor(
    private readonly prisma: PrismaService,
    private readonly campaigns: CampaignService,
    private readonly organizations: OrganizationService,
    private readonly ledger: LedgerService,
    private readonly entitlements: EntitlementsService,
    private readonly config: ConfigService<Env, true>,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGatewayPort,
  ) {}

  async createForCampaign(
    campaignId: string,
    requesterId: string,
    amountMinor: number,
    client: 'web' | 'app',
  ): Promise<FundingCreated> {
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
      throw new BadRequestException('Funding amount must be a positive integer.');
    }
    const campaign = await this.campaigns.requireCampaign(campaignId);
    await this.organizations.assertMember(campaign.organizationId, requesterId);

    const plan = await this.entitlements.forOrganization(campaign.organizationId);
    const feeMinor = EntitlementsService.feeMinor(amountMinor, plan.platformFeeBps);

    const bypassStripe = this.config.get('PAYMENTS_BYPASS_STRIPE', { infer: true });
    const checkout = bypassStripe
      ? { reference: `bypass_${randomUUID()}`, url: null }
      : await this.gateway.createFundingCheckout({
          amountMinor,
          feeMinor,
          feeLabel: `Zeyoo platform fee (${plan.platformFeeBps / 100}%)`,
          currencyCode: campaign.currencyCode,
          title: `Fund campaign: ${campaign.title}`,
          successUrl: this.returnUrl(campaignId, client, 'paid'),
          cancelUrl: this.returnUrl(campaignId, client, 'cancelled'),
          metadata: { campaignId },
        });
    const funding = await this.prisma.campaignFunding.create({
      data: {
        campaignId,
        organizationId: campaign.organizationId,
        amount: amountMinor,
        feeAmount: feeMinor,
        currencyCode: campaign.currencyCode,
        stripePaymentIntentId: checkout.reference,
      },
      select: { id: true },
    });
    if (bypassStripe) {
      await this.markSucceeded(checkout.reference);
    }
    return {
      fundingId: funding.id,
      checkoutUrl: checkout.url,
      amountMinor,
      feeMinor,
      currencyCode: campaign.currencyCode,
      status: bypassStripe ? 'SUCCEEDED' : 'PENDING',
    };
  }

  /**
   * Pays a campaign's budget (plus the plan fee) from the brand's wallet instead of a
   * card. Settles at once: the funding is recorded as succeeded, so the campaign can be
   * published straight away.
   */
  async fundFromWallet(
    campaignId: string,
    requesterId: string,
    amountMinor: number,
  ): Promise<FundingCreated> {
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
      throw new BadRequestException('Funding amount must be a positive integer.');
    }
    const campaign = await this.campaigns.requireCampaign(campaignId);
    await this.organizations.assertMember(campaign.organizationId, requesterId);
    if (campaign.currencyCode !== WALLET_CURRENCY) {
      throw new ConflictException(
        `Your wallet holds ${WALLET_CURRENCY}; pay for this ${campaign.currencyCode} campaign by card.`,
      );
    }
    const plan = await this.entitlements.forOrganization(campaign.organizationId);
    const feeMinor = EntitlementsService.feeMinor(amountMinor, plan.platformFeeBps);

    return this.walletLock.run(campaign.organizationId, async () => {
      const balance = await this.ledger.walletBalanceMinor(campaign.organizationId, WALLET_CURRENCY);
      if (balance < amountMinor + feeMinor) {
        throw new ConflictException(
          'Your wallet balance does not cover this budget and the platform fee. Add funds or pay by card.',
        );
      }
      const funding = await this.prisma.campaignFunding.create({
        data: {
          campaignId,
          organizationId: campaign.organizationId,
          amount: amountMinor,
          feeAmount: feeMinor,
          currencyCode: WALLET_CURRENCY,
          status: 'SUCCEEDED',
          stripePaymentIntentId: `wallet_${randomUUID()}`,
        },
        select: { id: true },
      });
      await this.ledger.recordWalletFunding(
        campaign.organizationId,
        Money.of(amountMinor, WALLET_CURRENCY),
        Money.of(feeMinor, WALLET_CURRENCY),
        funding.id,
      );
      return {
        fundingId: funding.id,
        checkoutUrl: null,
        amountMinor,
        feeMinor,
        currencyCode: WALLET_CURRENCY,
        status: 'SUCCEEDED' as const,
      };
    });
  }

  async latestForCampaign(campaignId: string, requesterId: string): Promise<FundingStatus | null> {
    const campaign = await this.campaigns.requireCampaign(campaignId);
    await this.organizations.assertMember(campaign.organizationId, requesterId);
    const latest = await this.prisma.campaignFunding.findFirst({
      where: { campaignId },
      orderBy: { createdAt: 'desc' },
    });
    return latest
      ? {
          fundingId: latest.id,
          amountMinor: latest.amount,
          feeMinor: latest.feeAmount,
          currencyCode: latest.currencyCode,
          status: latest.status,
        }
      : null;
  }

  async markSucceeded(reference: string): Promise<void> {
    const transitioned = await this.prisma.campaignFunding.updateMany({
      where: { stripePaymentIntentId: reference, status: 'PENDING' },
      data: { status: 'SUCCEEDED' },
    });
    if (transitioned.count === 0) {
      return;
    }
    const funding = await this.prisma.campaignFunding.findUniqueOrThrow({
      where: { stripePaymentIntentId: reference },
    });
    await this.ledger.recordFunding(
      funding.organizationId,
      Money.of(funding.amount, funding.currencyCode),
      funding.id,
    );
  }

  async markFailed(reference: string): Promise<void> {
    await this.prisma.campaignFunding.updateMany({
      where: { stripePaymentIntentId: reference, status: 'PENDING' },
      data: { status: 'FAILED' },
    });
  }

  /** What the campaign has been paid, less any budget refunded to the brand. */
  async totalSucceededMinor(campaignId: string): Promise<number> {
    const [funded, refunded] = await Promise.all([
      this.prisma.campaignFunding.aggregate({
        _sum: { amount: true },
        where: { campaignId, status: 'SUCCEEDED' },
      }),
      this.prisma.campaignRefund.aggregate({
        _sum: { amount: true },
        where: { campaignId, status: { in: ['PENDING', 'SUCCEEDED'] } },
      }),
    ]);
    return (funded._sum.amount ?? 0) - (refunded._sum.amount ?? 0);
  }

  /**
   * The web app waits on /funding/return, which publishes the campaign once paid. The
   * mobile app does that itself while Stripe is open, so it is just handed the campaign.
   */
  private returnUrl(
    campaignId: string,
    client: ReturnClient,
    outcome: 'paid' | 'cancelled',
  ): string {
    const base = this.config.get('APP_WEB_URL', { infer: true });
    return client === 'app'
      ? returnUrl(base, `${AppPaths.brandCampaign(campaignId)}?funding=${outcome}`, 'app')
      : appUrl(base, `/funding/return?campaignId=${campaignId}&client=web&outcome=${outcome}`);
  }
}
