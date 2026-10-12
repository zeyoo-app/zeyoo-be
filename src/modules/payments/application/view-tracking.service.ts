import { ConflictException, Injectable } from '@nestjs/common';
import { SocialPlatform } from '@prisma/client';
import { CampaignService } from '@modules/campaigns/campaigns.public';
import { OrganizationService } from '@modules/iam/iam.public';
import {
  MetricService,
  MetricsUnavailableError,
  MetricsUnavailableReason,
  PlatformMetricsService,
  UnifiedPostMetrics,
} from '@modules/social/social.public';
import { SubmissionLink, SubmissionService } from '@modules/submissions/submissions.public';
import { EarningsSettlementService, SettlementSummary } from './earnings-settlement.service';

export interface ManualViewsInput {
  views: number;
  likes?: number;
  comments?: number;
  shares?: number;
}

export type SyncOutcome =
  | { status: 'RECORDED'; platform: SocialPlatform; views: number }
  | { status: 'UNAVAILABLE'; reason: MetricsUnavailableReason; message: string };

export interface SubmissionSyncResult {
  submissionId: string;
  outcome: SyncOutcome;
}

export interface TrackingResult {
  results: SubmissionSyncResult[];
  settlement: SettlementSummary;
}

/**
 * Gets a submission's views into the system — typed in by a brand member, or read
 * from the platform — then settles the campaign so creators are credited straight
 * away. Both paths write the same kind of snapshot, so everything downstream
 * (reports, earnings) is blind to where a number came from.
 */
@Injectable()
export class ViewTrackingService {
  constructor(
    private readonly campaigns: CampaignService,
    private readonly organizations: OrganizationService,
    private readonly submissions: SubmissionService,
    private readonly metrics: MetricService,
    private readonly platformMetrics: PlatformMetricsService,
    private readonly settlement: EarningsSettlementService,
  ) {}

  async recordManualViews(
    submissionId: string,
    requesterId: string,
    input: ManualViewsInput,
  ): Promise<TrackingResult> {
    const submission = await this.submissions.withLatestLink(submissionId);
    await this.assertCanManage(submission.campaignId, requesterId);
    if (submission.status !== 'APPROVED') {
      throw new ConflictException('Views can only be recorded for an approved submission.');
    }
    const campaign = await this.campaigns.requireCampaign(submission.campaignId);
    const platform = this.platformOf(submission, campaign.platform);
    await this.metrics.recordSnapshot({
      campaignId: campaign.id,
      creatorUserId: submission.creatorUserId,
      submissionId,
      platform,
      source: 'MANUAL',
      metrics: toUnified(input),
    });
    return {
      results: [{ submissionId, outcome: { status: 'RECORDED', platform, views: input.views } }],
      settlement: await this.settlement.settleCampaignAsSystem(campaign.id),
    };
  }

  async syncSubmission(submissionId: string, requesterId: string): Promise<TrackingResult> {
    const submission = await this.submissions.withLatestLink(submissionId);
    await this.assertCanManage(submission.campaignId, requesterId);
    if (submission.status !== 'APPROVED') {
      throw new ConflictException('Views can only be synced for an approved submission.');
    }
    const result = await this.pullFromPlatform(submission);
    return {
      results: [result],
      settlement: await this.settlement.settleCampaignAsSystem(submission.campaignId),
    };
  }

  async syncCampaign(campaignId: string, requesterId: string): Promise<TrackingResult> {
    await this.assertCanManage(campaignId, requesterId);
    return this.refreshCampaign(campaignId);
  }

  /** The scheduled pass: every live campaign, on behalf of the platform. */
  async refreshAllLiveCampaigns(): Promise<void> {
    const live = await this.campaigns.listPublished();
    for (const campaign of live) {
      await this.refreshCampaign(campaign.id);
    }
  }

  private async refreshCampaign(campaignId: string): Promise<TrackingResult> {
    const approved = await this.submissions.approvedWithLatestLink(campaignId);
    const results: SubmissionSyncResult[] = [];
    for (const submission of approved) {
      results.push(await this.pullFromPlatform(submission));
    }
    return { results, settlement: await this.settlement.settleCampaignAsSystem(campaignId) };
  }

  private async pullFromPlatform(submission: SubmissionLink): Promise<SubmissionSyncResult> {
    const { submissionId } = submission;
    if (!submission.postUrl) {
      return unavailable(
        submissionId,
        'UNSUPPORTED_PLATFORM',
        'This submission has no post link; enter views manually.',
      );
    }
    try {
      const { platform, metrics } = await this.platformMetrics.fetchForPost(
        submission.postUrl,
        submission.creatorUserId,
      );
      await this.metrics.recordSnapshot({
        campaignId: submission.campaignId,
        creatorUserId: submission.creatorUserId,
        submissionId,
        platform,
        source: 'PLATFORM_API',
        metrics,
      });
      return { submissionId, outcome: { status: 'RECORDED', platform, views: metrics.views } };
    } catch (error) {
      if (error instanceof MetricsUnavailableError) {
        return unavailable(submissionId, error.reason, error.message);
      }
      throw error;
    }
  }

  private platformOf(submission: SubmissionLink, fallback: SocialPlatform): SocialPlatform {
    if (!submission.postUrl) {
      return fallback;
    }
    try {
      return this.platformMetrics.identify(submission.postUrl).platform;
    } catch {
      return fallback;
    }
  }

  private async assertCanManage(campaignId: string, requesterId: string): Promise<void> {
    const campaign = await this.campaigns.requireCampaign(campaignId);
    await this.organizations.assertMember(campaign.organizationId, requesterId);
  }
}

function unavailable(
  submissionId: string,
  reason: MetricsUnavailableReason,
  message: string,
): SubmissionSyncResult {
  return { submissionId, outcome: { status: 'UNAVAILABLE', reason, message } };
}

function toUnified(input: ManualViewsInput): UnifiedPostMetrics {
  return {
    views: input.views,
    likes: input.likes ?? null,
    comments: input.comments ?? null,
    shares: input.shares ?? null,
    capturedAt: new Date(),
  };
}
