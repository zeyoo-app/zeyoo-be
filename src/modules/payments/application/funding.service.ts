import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '@platform/database/prisma.service';
import { Env } from '@platform/config/env.schema';
import { CampaignService } from '@modules/campaigns/campaigns.public';
import { OrganizationService } from '@modules/iam/iam.public';
import { Money } from '../domain/money';
import { PAYMENT_GATEWAY, PaymentGatewayPort } from '../domain/ports/payment-gateway.port';
import { LedgerService } from './ledger.service';

export interface FundingStatus {
  fundingId: string;
  amountMinor: number;
  currencyCode: string;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
}

export interface FundingCreated extends FundingStatus {
  /** Stripe's hosted payment page; null when the payment was settled without it. */
  checkoutUrl: string | null;
}

@Injectable()
export class FundingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly campaigns: CampaignService,
    private readonly organizations: OrganizationService,
    private readonly ledger: LedgerService,
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

    const bypassStripe = this.config.get('PAYMENTS_BYPASS_STRIPE', { infer: true });
    const checkout = bypassStripe
      ? { reference: `bypass_${randomUUID()}`, url: null }
      : await this.gateway.createFundingCheckout({
          amountMinor,
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
      currencyCode: campaign.currencyCode,
      status: bypassStripe ? 'SUCCEEDED' : 'PENDING',
    };
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

  private returnUrl(
    campaignId: string,
    client: 'web' | 'app',
    outcome: 'paid' | 'cancelled',
  ): string {
    const base = this.config.get('APP_WEB_URL', { infer: true }).replace(/\/$/, '');
    return `${base}/funding/return?campaignId=${campaignId}&client=${client}&outcome=${outcome}`;
  }
}
