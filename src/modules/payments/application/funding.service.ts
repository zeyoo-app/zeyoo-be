import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '@platform/database/prisma.service';
import { CampaignService } from '@modules/campaigns/campaigns.public';
import { OrganizationService } from '@modules/iam/iam.public';
import { Money } from '../domain/money';
import { PAYMENT_GATEWAY, PaymentGatewayPort } from '../domain/ports/payment-gateway.port';
import { LedgerService } from './ledger.service';

export interface FundingCreated {
  fundingId: string;
  clientSecret: string;
  amountMinor: number;
  currencyCode: string;
}

@Injectable()
export class FundingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly campaigns: CampaignService,
    private readonly organizations: OrganizationService,
    private readonly ledger: LedgerService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGatewayPort,
  ) {}

  async createForCampaign(
    campaignId: string,
    requesterId: string,
    amountMinor: number,
  ): Promise<FundingCreated> {
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
      throw new BadRequestException('Funding amount must be a positive integer.');
    }
    const campaign = await this.campaigns.requireCampaign(campaignId);
    await this.organizations.assertMember(campaign.organizationId, requesterId);

    const intent = await this.gateway.createFundingIntent({
      amountMinor,
      currencyCode: campaign.currencyCode,
      metadata: { campaignId },
    });
    const funding = await this.prisma.campaignFunding.create({
      data: {
        campaignId,
        organizationId: campaign.organizationId,
        amount: amountMinor,
        currencyCode: campaign.currencyCode,
        stripePaymentIntentId: intent.intentId,
      },
      select: { id: true },
    });
    return {
      fundingId: funding.id,
      clientSecret: intent.clientSecret,
      amountMinor,
      currencyCode: campaign.currencyCode,
    };
  }

  // Idempotent: the conditional status transition guards against duplicate
  // webhook deliveries recording the ledger entry twice.
  async markSucceeded(intentId: string): Promise<void> {
    const transitioned = await this.prisma.campaignFunding.updateMany({
      where: { stripePaymentIntentId: intentId, status: 'PENDING' },
      data: { status: 'SUCCEEDED' },
    });
    if (transitioned.count === 0) {
      return;
    }
    const funding = await this.prisma.campaignFunding.findUniqueOrThrow({
      where: { stripePaymentIntentId: intentId },
    });
    await this.ledger.recordFunding(
      funding.organizationId,
      Money.of(funding.amount, funding.currencyCode),
      funding.id,
    );
  }

  async markFailed(intentId: string): Promise<void> {
    await this.prisma.campaignFunding.updateMany({
      where: { stripePaymentIntentId: intentId, status: 'PENDING' },
      data: { status: 'FAILED' },
    });
  }
}
