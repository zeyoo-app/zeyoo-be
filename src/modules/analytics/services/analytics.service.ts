import { Injectable } from '@nestjs/common';
import { ApplicationService } from '@modules/applications/applications.public';
import { CampaignService } from '@modules/campaigns/campaigns.public';
import { OrganizationService } from '@modules/iam/iam.public';
import { CreatorProfileService } from '@modules/creators/creators.public';
import { EarningsSettlementService, FundingService } from '@modules/payments/payments.public';
import { MetricService } from '@modules/social/social.public';
import { SubmissionService } from '@modules/submissions/submissions.public';

export interface CampaignReport {
  campaignId: string;
  title: string;
  currencyCode: string;
  budgetMinor: number;
  fundedMinor: number;
  totalViews: number;
  applications: { total: number; approved: number };
  submissions: { total: number; approved: number };
  /** Paid out (credited) to creators so far, in minor units. */
  spentMinor: number;
  /** What the campaign has cost per 1,000 views so far; null before any views. */
  costPerThousandViewsMinor: number | null;
  /** Creators with the most views, with what each has earned. */
  topCreators: {
    creatorUserId: string;
    name: string;
    views: number;
    accruedMinor: number;
    paused: boolean;
  }[];
}

const TOP_CREATOR_LIMIT = 5;
const VIEWS_PER_THOUSAND = 1_000;

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly campaigns: CampaignService,
    private readonly organizations: OrganizationService,
    private readonly applications: ApplicationService,
    private readonly submissions: SubmissionService,
    private readonly funding: FundingService,
    private readonly metrics: MetricService,
    private readonly earnings: EarningsSettlementService,
    private readonly profiles: CreatorProfileService,
  ) {}

  async campaignReport(campaignId: string, requesterId: string): Promise<CampaignReport> {
    const campaign = await this.campaigns.requireCampaign(campaignId);
    await this.organizations.assertMember(campaign.organizationId, requesterId);

    const [applications, submissions, fundedMinor, totalViews, earnings] = await Promise.all([
      this.applications.summaryForCampaign(campaignId),
      this.submissions.summaryForCampaign(campaignId),
      this.funding.totalSucceededMinor(campaignId),
      this.metrics.totalViewsForCampaign(campaignId),
      this.earnings.getCampaignEarnings(campaignId, requesterId),
    ]);
    const top = [...earnings.creators]
      .sort((first, second) => second.views - first.views)
      .slice(0, TOP_CREATOR_LIMIT);
    const names = await this.profiles.summariesByUserIds(
      top.map((creator) => creator.creatorUserId),
    );

    return {
      campaignId,
      title: campaign.title,
      currencyCode: campaign.currencyCode,
      budgetMinor: campaign.budgetAmount,
      fundedMinor,
      totalViews,
      applications,
      submissions,
      spentMinor: earnings.spentMinor,
      costPerThousandViewsMinor:
        totalViews > 0 ? Math.round((earnings.spentMinor / totalViews) * VIEWS_PER_THOUSAND) : null,
      topCreators: top.map((creator) => ({
        creatorUserId: creator.creatorUserId,
        name: names.get(creator.creatorUserId)?.displayName ?? 'Creator',
        views: creator.views,
        accruedMinor: creator.accruedMinor,
        paused: creator.paused,
      })),
    };
  }

  /**
   * The campaign summary as a CSV file (contract §1.2, "downloadable basic campaign
   * summary report"): the headline numbers, then one row per creator who earned on it.
   */
  async campaignReportCsv(campaignId: string, requesterId: string): Promise<string> {
    const report = await this.campaignReport(campaignId, requesterId);
    const earnings = await this.earnings.getCampaignEarnings(campaignId, requesterId);
    const names = await this.profiles.summariesByUserIds(
      earnings.creators.map((creator) => creator.creatorUserId),
    );
    const money = (minor: number | null): string =>
      minor === null ? '' : (minor / MINOR_UNITS_PER_MAJOR).toFixed(2);
    const rows: (string | number)[][] = [
      ['Campaign', report.title],
      ['Currency', report.currencyCode],
      ['Budget', money(report.budgetMinor)],
      ['Funded', money(report.fundedMinor)],
      ['Paid to creators', money(report.spentMinor)],
      ['Total views', report.totalViews],
      ['Cost per 1,000 views', money(report.costPerThousandViewsMinor)],
      ['Applications', report.applications.total],
      ['Applications approved', report.applications.approved],
      ['Submissions', report.submissions.total],
      ['Submissions approved', report.submissions.approved],
      [],
      ['Creator', 'Views', 'Earned', 'Earnings paused'],
      ...[...earnings.creators]
        .sort((first, second) => second.views - first.views)
        .map((creator) => [
          names.get(creator.creatorUserId)?.displayName ?? 'Creator',
          creator.views,
          money(creator.accruedMinor),
          creator.paused ? 'yes' : 'no',
        ]),
    ];
    return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }
}

const MINOR_UNITS_PER_MAJOR = 100;

/** Quotes a value for CSV and neutralises spreadsheet formulas (a leading =, +, - or @). */
function csvCell(value: string | number): string {
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@]/.test(text)) {
    text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
