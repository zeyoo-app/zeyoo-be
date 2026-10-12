import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CampaignFunding, CampaignRefund } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { Env } from '@platform/config/env.schema';
import { PrismaService } from '@platform/database/prisma.service';
import { CampaignService } from '@modules/campaigns/campaigns.public';
import { NotificationService } from '@modules/notifications/notifications.public';
import { Money } from '../domain/money';
import { PAYMENT_GATEWAY, PaymentGatewayPort } from '../domain/ports/payment-gateway.port';
import { LedgerService } from './ledger.service';

const MINOR_UNITS_PER_MAJOR = 100;

export interface RefundOutcome {
  refundedMinor: number;
  currencyCode: string;
  refunds: number;
}

/**
 * Returns a campaign's unspent budget to the brand's card. The amount is what was paid
 * in, less what creators have been credited and what has already been refunded.
 */
@Injectable()
export class RefundService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly campaigns: CampaignService,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationService,
    private readonly config: ConfigService<Env, true>,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGatewayPort,
  ) {}

  async refundableMinor(campaignId: string): Promise<number> {
    const [funded, refunded, accrued] = await Promise.all([
      this.sum('campaignFunding', { campaignId, status: 'SUCCEEDED' }, 'amount'),
      this.sum(
        'campaignRefund',
        { campaignId, status: { in: ['PENDING', 'SUCCEEDED'] } },
        'amount',
      ),
      this.sum('creatorEarning', { campaignId }, 'accruedAmount'),
    ]);
    return Math.max(0, funded - refunded - accrued);
  }

  async refundUnspent(campaignId: string, adminUserId: string): Promise<RefundOutcome> {
    const campaign = await this.campaigns.requireCampaign(campaignId);
    if (campaign.status === 'PUBLISHED') {
      throw new ConflictException('Close the campaign before refunding its unspent budget.');
    }
    let remaining = await this.refundableMinor(campaignId);
    if (remaining <= 0) {
      throw new ConflictException('This campaign has no unspent budget to refund.');
    }
    const fundings = await this.prisma.campaignFunding.findMany({
      where: { campaignId, status: 'SUCCEEDED' },
      orderBy: { createdAt: 'desc' },
    });
    let refunded = 0;
    let count = 0;
    for (const funding of fundings) {
      if (remaining <= 0) break;
      const available = await this.refundableOn(funding);
      const amount = Math.min(available, remaining);
      if (amount <= 0) continue;
      await this.refundFunding(funding, amount, adminUserId);
      remaining -= amount;
      refunded += amount;
      count += 1;
    }
    await this.notifications.notify({
      userId: campaign.createdByUserId,
      type: 'CAMPAIGN_REFUNDED',
      title: 'Unspent budget refunded',
      body: `${(refunded / MINOR_UNITS_PER_MAJOR).toFixed(2)} ${campaign.currencyCode} from "${campaign.title}" is on its way back to your card.`,
    });
    return { refundedMinor: refunded, currencyCode: campaign.currencyCode, refunds: count };
  }

  async refundedMinor(campaignId: string): Promise<number> {
    return this.sum('campaignRefund', { campaignId, status: 'SUCCEEDED' }, 'amount');
  }

  private async refundFunding(
    funding: CampaignFunding,
    amountMinor: number,
    adminUserId: string,
  ): Promise<CampaignRefund> {
    const refund = await this.prisma.campaignRefund.create({
      data: {
        campaignId: funding.campaignId,
        organizationId: funding.organizationId,
        fundingId: funding.id,
        amount: amountMinor,
        currencyCode: funding.currencyCode,
        createdByUserId: adminUserId,
      },
    });
    try {
      const bypass = this.config.get('PAYMENTS_BYPASS_STRIPE', { infer: true });
      const result = bypass
        ? { refundId: `bypass_refund_${randomUUID()}` }
        : await this.gateway.refundPayment({
            reference: funding.stripePaymentIntentId,
            amountMinor,
            idempotencyKey: `refund-${refund.id}`,
          });
      await this.ledger.recordRefund(
        funding.organizationId,
        Money.of(amountMinor, funding.currencyCode),
        refund.id,
      );
      return await this.prisma.campaignRefund.update({
        where: { id: refund.id },
        data: { status: 'SUCCEEDED', stripeRefundId: result.refundId },
      });
    } catch (error) {
      await this.prisma.campaignRefund.update({
        where: { id: refund.id },
        data: { status: 'FAILED' },
      });
      throw error;
    }
  }

  private async refundableOn(funding: CampaignFunding): Promise<number> {
    const refunded = await this.sum(
      'campaignRefund',
      { fundingId: funding.id, status: { in: ['PENDING', 'SUCCEEDED'] } },
      'amount',
    );
    return Math.max(0, funding.amount - refunded);
  }

  private async sum(
    model: 'campaignFunding' | 'campaignRefund' | 'creatorEarning',
    where: object,
    field: string,
  ): Promise<number> {
    const delegate = this.prisma[model] as unknown as {
      aggregate(args: object): Promise<{ _sum: Record<string, number | null> }>;
    };
    const result = await delegate.aggregate({ _sum: { [field]: true }, where });
    return result._sum[field] ?? 0;
  }
}
