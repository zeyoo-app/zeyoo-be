import { Injectable } from '@nestjs/common';
import { ApplicationService } from '@modules/applications/applications.public';
import { CampaignService } from '@modules/campaigns/campaigns.public';
import { OrganizationService } from '@modules/iam/iam.public';
import { FundingService } from '@modules/payments/payments.public';
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
}

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly campaigns: CampaignService,
    private readonly organizations: OrganizationService,
    private readonly applications: ApplicationService,
    private readonly submissions: SubmissionService,
    private readonly funding: FundingService,
    private readonly metrics: MetricService,
  ) {}

  async campaignReport(campaignId: string, requesterId: string): Promise<CampaignReport> {
    const campaign = await this.campaigns.requireCampaign(campaignId);
    await this.organizations.assertMember(campaign.organizationId, requesterId);

    const [applications, submissions, fundedMinor, totalViews] = await Promise.all([
      this.applications.summaryForCampaign(campaignId),
      this.submissions.summaryForCampaign(campaignId),
      this.funding.totalSucceededMinor(campaignId),
      this.metrics.totalViewsForCampaign(campaignId),
    ]);

    return {
      campaignId,
      title: campaign.title,
      currencyCode: campaign.currencyCode,
      budgetMinor: campaign.budgetAmount,
      fundedMinor,
      totalViews,
      applications,
      submissions,
    };
  }
}
