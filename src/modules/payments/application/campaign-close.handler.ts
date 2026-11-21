import { Injectable, OnModuleInit } from '@nestjs/common';
import { Campaign } from '@prisma/client';
import { CampaignService } from '@modules/campaigns/campaigns.public';
import { WALLET_CURRENCY } from '../domain/wallet';
import { RefundService } from './refund.service';

/**
 * When a USD campaign closes, its unspent budget goes back to the brand's wallet at once.
 * Only what the brand has paid creators is kept: views gained since the brand last paid
 * are not paid automatically. Other currencies have no wallet and keep the manual card
 * refund.
 */
@Injectable()
export class CampaignCloseHandler implements OnModuleInit {
  constructor(
    private readonly campaigns: CampaignService,
    private readonly refunds: RefundService,
  ) {}

  onModuleInit(): void {
    this.campaigns.onClosed((campaign, closedByUserId) =>
      this.returnUnspent(campaign, closedByUserId),
    );
  }

  async returnUnspent(campaign: Campaign, closedByUserId: string): Promise<void> {
    if (campaign.currencyCode !== WALLET_CURRENCY) return;
    if ((await this.refunds.refundableMinor(campaign.id)) <= 0) return;
    await this.refunds.refundUnspent(campaign.id, closedByUserId);
  }
}
