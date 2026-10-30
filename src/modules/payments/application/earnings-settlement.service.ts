import { Injectable } from '@nestjs/common';
import { Campaign, RiskLevel } from '@prisma/client';
import { PrismaService } from '@platform/database/prisma.service';
import { AppPaths } from '@platform/links';
import { CampaignService } from '@modules/campaigns/campaigns.public';
import { assessEngagement, FraudService } from '@modules/fraud/fraud.public';
import { OrganizationService } from '@modules/iam/iam.public';
import { NotificationService } from '@modules/notifications/notifications.public';
import { MetricService } from '@modules/social/social.public';
import { SubmissionService } from '@modules/submissions/submissions.public';
import { calculateCreatorEntitlement } from '../domain/earnings-calculator';
import { Money } from '../domain/money';
import { FundingService } from './funding.service';
import { LedgerService } from './ledger.service';

export interface CreatorSettlement {
  creatorUserId: string;
  views: number;
  /** Total credited to the creator for this campaign, including this pass. */
  accruedMinor: number;
  /** Newly credited by this pass. */
  creditedNowMinor: number;
  /** An open or confirmed fraud case is stopping this creator's earnings. */
  paused: boolean;
}

export interface CampaignEarnings {
  campaignId: string;
  currencyCode: string;
  spentMinor: number;
  creators: {
    creatorUserId: string;
    views: number;
    accruedMinor: number;
    paused: boolean;
    risk: RiskLevel;
  }[];
}

export interface CreatorCampaignEarnings {
  campaignId: string;
  campaignTitle: string;
  currencyCode: string;
  views: number;
  accruedMinor: number;
  /** The most the creator can earn from the campaign; null when it has no per-creator limit. */
  capMinor: number | null;
  /** A fraud review is stopping new earnings on this campaign. */
  paused: boolean;
}

export interface SettlementSummary {
  campaignId: string;
  currencyCode: string;
  creators: CreatorSettlement[];
  totalAccruedMinor: number;
  budgetRemainingMinor: number;
}

const MINOR_UNITS_PER_MAJOR = 100;
const NO_ENGAGEMENT = { views: 0, likes: 0, comments: 0, shares: 0 };

/**
 * Turns approved submissions and their latest view counts into creator earnings.
 * Idempotent: each pass credits only what a creator is newly entitled to, and never
 * more than the campaign's budget or what its brand has actually funded.
 */
@Injectable()
export class EarningsSettlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly campaigns: CampaignService,
    private readonly organizations: OrganizationService,
    private readonly submissions: SubmissionService,
    private readonly metrics: MetricService,
    private readonly funding: FundingService,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationService,
    private readonly fraud: FraudService,
  ) {}

  async settleCampaign(campaignId: string, requesterId: string): Promise<SettlementSummary> {
    const campaign = await this.campaigns.requireCampaign(campaignId);
    await this.organizations.assertMember(campaign.organizationId, requesterId);
    return this.settle(campaign);
  }

  /** Where the campaign stands now, without crediting anything. */
  async getCampaignEarnings(campaignId: string, requesterId: string): Promise<CampaignEarnings> {
    const campaign = await this.campaigns.requireCampaign(campaignId);
    await this.organizations.assertMember(campaign.organizationId, requesterId);
    const [readings, accruedByCreator, pausedCreatorIds] = await Promise.all([
      this.metrics.latestReadingsByCreator(campaignId),
      this.accruedByCreator(campaignId),
      this.fraud.pausedCreatorIds(campaignId),
    ]);
    const creatorIds = new Set([...readings.keys(), ...accruedByCreator.keys()]);
    return {
      campaignId,
      currencyCode: campaign.currencyCode,
      spentMinor: sum(accruedByCreator.values()),
      creators: [...creatorIds].map((creatorUserId) => ({
        creatorUserId,
        views: readings.get(creatorUserId)?.views ?? 0,
        accruedMinor: accruedByCreator.get(creatorUserId) ?? 0,
        paused: pausedCreatorIds.has(creatorUserId),
        risk: assessEngagement(readings.get(creatorUserId) ?? NO_ENGAGEMENT),
      })),
    };
  }

  /** What one creator has earned from each campaign they submitted to, and their cap in each. */
  async getCreatorEarnings(creatorUserId: string): Promise<CreatorCampaignEarnings[]> {
    const campaignIds = [...new Set(await this.submissions.campaignIdsForCreator(creatorUserId))];
    if (campaignIds.length === 0) {
      return [];
    }
    const [campaigns, viewsByCampaign, accrued, pausedCampaignIds] = await Promise.all([
      this.campaigns.findManyByIds(campaignIds),
      this.metrics.latestViewsByCampaignForCreator(creatorUserId),
      this.prisma.creatorEarning.findMany({
        where: { creatorUserId, campaignId: { in: campaignIds } },
      }),
      this.fraud.pausedCampaignIds(creatorUserId),
    ]);
    const accruedByCampaign = new Map(accrued.map((row) => [row.campaignId, row.accruedAmount]));
    return campaigns.map((campaign) => ({
      campaignId: campaign.id,
      campaignTitle: campaign.title,
      currencyCode: campaign.currencyCode,
      views: viewsByCampaign.get(campaign.id) ?? 0,
      accruedMinor: accruedByCampaign.get(campaign.id) ?? 0,
      capMinor: campaign.maxRewardPerCreatorAmount,
      paused: pausedCampaignIds.has(campaign.id),
    }));
  }

  /** For the scheduler, which acts for the platform rather than for a brand member. */
  async settleCampaignAsSystem(campaignId: string): Promise<SettlementSummary> {
    return this.settle(await this.campaigns.requireCampaign(campaignId));
  }

  private async settle(campaign: Campaign): Promise<SettlementSummary> {
    const campaignId = campaign.id;
    const [creatorIds, viewsByCreator, spendableMinor, accruedByCreator, pausedCreatorIds] =
      await Promise.all([
        this.submissions.approvedCreatorIds(campaignId),
        this.metrics.latestViewsByCreator(campaignId),
        this.spendableMinor(campaign),
        this.accruedByCreator(campaignId),
        this.fraud.pausedCreatorIds(campaignId),
      ]);

    let budgetRemainingMinor = spendableMinor - sum(accruedByCreator.values());
    const creators: CreatorSettlement[] = [];
    // Sequential on purpose: each credit shrinks the budget the next one may use.
    for (const creatorUserId of creatorIds) {
      const views = viewsByCreator.get(creatorUserId) ?? 0;
      const alreadyAccrued = accruedByCreator.get(creatorUserId) ?? 0;
      const entitledMinor = this.entitledMinor(campaign, views);
      const paused = pausedCreatorIds.has(creatorUserId);
      const creditMinor = paused
        ? 0
        : Math.max(0, Math.min(entitledMinor - alreadyAccrued, budgetRemainingMinor));
      const credited =
        creditMinor > 0 &&
        (await this.accrue(campaign, creatorUserId, creditMinor, alreadyAccrued));
      const creditedNowMinor = credited ? creditMinor : 0;
      if (credited) {
        await this.notifyCredited(campaign, creatorUserId, creditMinor);
      }
      budgetRemainingMinor -= creditedNowMinor;
      creators.push({
        creatorUserId,
        views,
        accruedMinor: alreadyAccrued + creditedNowMinor,
        creditedNowMinor,
        paused,
      });
    }

    return {
      campaignId,
      currencyCode: campaign.currencyCode,
      creators,
      totalAccruedMinor: spendableMinor - budgetRemainingMinor,
      budgetRemainingMinor,
    };
  }

  private notifyCredited(
    campaign: Campaign,
    creatorUserId: string,
    creditMinor: number,
  ): Promise<void> {
    const amount = `${(creditMinor / MINOR_UNITS_PER_MAJOR).toFixed(2)} ${campaign.currencyCode}`;
    return this.notifications.notify({
      userId: creatorUserId,
      type: 'EARNING_CREDITED',
      title: `You earned ${amount}`,
      body: `New views on "${campaign.title}" added ${amount} to your balance.`,
      link: AppPaths.creatorWallet,
    });
  }

  private entitledMinor(campaign: Campaign, views: number): number {
    const { currencyCode } = campaign;
    const maxPerCreator = campaign.maxRewardPerCreatorAmount;
    return calculateCreatorEntitlement({
      rewardType: campaign.rewardType,
      reward: Money.of(campaign.rewardAmount, currencyCode),
      views,
      maxPerCreator: maxPerCreator === null ? null : Money.of(maxPerCreator, currencyCode),
    }).amountMinor;
  }

  // Nothing beyond the budget can be paid, and nothing beyond what was funded.
  private async spendableMinor(campaign: Campaign): Promise<number> {
    const fundedMinor = await this.funding.totalSucceededMinor(campaign.id);
    return Math.min(campaign.budgetAmount, fundedMinor);
  }

  private async accruedByCreator(campaignId: string): Promise<Map<string, number>> {
    const rows = await this.prisma.creatorEarning.findMany({ where: { campaignId } });
    return new Map(rows.map((row) => [row.creatorUserId, row.accruedAmount]));
  }

  /**
   * Claims the credit on the creator's running total first — a conditional write, so
   * two concurrent passes cannot both credit the same amount — then posts it to the
   * ledger, releasing the claim if the posting fails. Returns false when another
   * pass won the claim.
   */
  private async accrue(
    campaign: Campaign,
    creatorUserId: string,
    creditMinor: number,
    previousMinor: number,
  ): Promise<boolean> {
    const newTotalMinor = previousMinor + creditMinor;
    if (!(await this.claim(campaign, creatorUserId, previousMinor, newTotalMinor))) {
      return false;
    }
    try {
      await this.ledger.recordEarning(
        campaign.organizationId,
        creatorUserId,
        Money.of(creditMinor, campaign.currencyCode),
        `earning:${campaign.id}:${creatorUserId}:${newTotalMinor}`,
      );
    } catch (error) {
      await this.claim(campaign, creatorUserId, newTotalMinor, previousMinor);
      throw error;
    }
    return true;
  }

  private async claim(
    campaign: Campaign,
    creatorUserId: string,
    expectedTotalMinor: number,
    newTotalMinor: number,
  ): Promise<boolean> {
    const where = { campaignId: campaign.id, creatorUserId };
    const updated = await this.prisma.creatorEarning.updateMany({
      where: { ...where, accruedAmount: expectedTotalMinor },
      data: { accruedAmount: newTotalMinor },
    });
    if (updated.count > 0) {
      return true;
    }
    if (expectedTotalMinor !== 0) {
      return false;
    }
    return this.createFirstClaim(campaign, creatorUserId, newTotalMinor);
  }

  private async createFirstClaim(
    campaign: Campaign,
    creatorUserId: string,
    totalMinor: number,
  ): Promise<boolean> {
    try {
      await this.prisma.creatorEarning.create({
        data: {
          campaignId: campaign.id,
          creatorUserId,
          accruedAmount: totalMinor,
          currencyCode: campaign.currencyCode,
        },
      });
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) {
        return false;
      }
      throw error;
    }
  }
}

function sum(values: Iterable<number>): number {
  return [...values].reduce((total, value) => total + value, 0);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002'
  );
}
