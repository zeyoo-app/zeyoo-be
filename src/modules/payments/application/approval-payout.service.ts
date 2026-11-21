import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { MetricSource, SocialPlatform } from '@prisma/client';
import { CampaignService } from '@modules/campaigns/campaigns.public';
import { OrganizationService } from '@modules/iam/iam.public';
import {
  MetricService,
  MetricsUnavailableError,
  PlatformMetricsService,
} from '@modules/social/social.public';
import { ReviewService, SubmissionService } from '@modules/submissions/submissions.public';
import { EarningsSettlementService, PayoutQuote } from './earnings-settlement.service';
import { SubmissionSyncResult, ViewTrackingService } from './view-tracking.service';

/** One channel's views as the brand sees them before deciding. */
export interface PreviewPost {
  platform: SocialPlatform;
  /** Null for views entered against an uploaded video with no post. */
  url: string | null;
  /** Null when the platform couldn't be read and nothing was recorded before. */
  views: number | null;
  /** 'LIVE' was read from the platform just now; otherwise where the last recorded count came from. */
  source: 'LIVE' | MetricSource | null;
  capturedAt: Date | null;
  /** Why the platform couldn't be read live, when it couldn't. */
  unavailableMessage: string | null;
}

export interface PayoutPreview {
  submissionId: string;
  posts: PreviewPost[];
  totalViews: number;
  quote: PayoutQuote;
}

export interface ApprovalResult {
  submissionId: string;
  results: SubmissionSyncResult[];
  currencyCode: string;
  /** Credited to this creator by the approval. */
  paidNowMinor: number;
  views: number;
  /** The approval stands but paying failed; the brand can pay from the submission. */
  payoutDeferred: boolean;
}

/**
 * The only way creators get paid, always by the brand: before deciding, the brand sees
 * every channel's current views and exactly what approving would pay; approving reads
 * the views for the record and pays that creator. Views gained afterwards are paid only
 * when the brand pays for them, seeing the amount first the same way.
 */
@Injectable()
export class ApprovalPayoutService {
  private readonly logger = new Logger(ApprovalPayoutService.name);

  constructor(
    private readonly campaigns: CampaignService,
    private readonly organizations: OrganizationService,
    private readonly submissions: SubmissionService,
    private readonly reviews: ReviewService,
    private readonly metrics: MetricService,
    private readonly platformMetrics: PlatformMetricsService,
    private readonly settlement: EarningsSettlementService,
    private readonly tracking: ViewTrackingService,
  ) {}

  /**
   * Reads each post live without recording it, so nothing counts toward earnings
   * until the brand approves. A channel that can't be read shows its last recorded count.
   */
  async preview(submissionId: string, requesterId: string): Promise<PayoutPreview> {
    const submission = await this.submissions.withLatestLink(submissionId);
    const campaign = await this.campaigns.requireCampaign(submission.campaignId);
    await this.organizations.assertMember(campaign.organizationId, requesterId);

    const recorded = await this.metrics.latestByPlatformForCreator(
      campaign.id,
      submission.creatorUserId,
    );
    const posts: PreviewPost[] = [];
    for (const post of submission.posts) {
      const last = recorded.get(post.platform);
      const fallback = {
        platform: post.platform,
        url: post.url,
        views: last?.views ?? null,
        source: last?.source ?? null,
        capturedAt: last?.capturedAt ?? null,
      };
      try {
        const { metrics } = await this.platformMetrics.fetchForPost(
          post.url,
          submission.creatorUserId,
        );
        posts.push({
          ...fallback,
          views: metrics.views,
          source: 'LIVE',
          capturedAt: metrics.capturedAt,
          unavailableMessage: null,
        });
      } catch (error) {
        if (!(error instanceof MetricsUnavailableError)) throw error;
        posts.push({ ...fallback, unavailableMessage: error.message });
      }
    }
    // Views typed in for an upload without posts still count, as they do in settlement.
    const listed = new Set(posts.map((post) => post.platform));
    for (const [platform, reading] of recorded) {
      if (listed.has(platform)) continue;
      posts.push({
        platform,
        url: null,
        views: reading.views,
        source: reading.source,
        capturedAt: reading.capturedAt,
        unavailableMessage: null,
      });
    }

    const totalViews = posts.reduce((total, post) => total + (post.views ?? 0), 0);
    return {
      submissionId,
      posts,
      totalViews,
      quote: await this.settlement.quote(campaign, submission.creatorUserId, totalViews),
    };
  }

  /** Approves, records the views as they stand, and pays the creator for them. */
  async approveAndPay(
    submissionId: string,
    requesterId: string,
    note?: string,
  ): Promise<ApprovalResult> {
    await this.reviews.review(submissionId, requesterId, { decision: 'APPROVED', note });
    return this.recordAndPay(submissionId, requesterId);
  }

  /** Pays an approved creator for the views gained since they were last paid. */
  async payForNewViews(submissionId: string, requesterId: string): Promise<ApprovalResult> {
    const submission = await this.submissions.withLatestLink(submissionId);
    const campaign = await this.campaigns.requireCampaign(submission.campaignId);
    await this.organizations.assertMember(campaign.organizationId, requesterId);
    if (submission.status !== 'APPROVED') {
      throw new ConflictException('Only an approved submission can be paid.');
    }
    return this.recordAndPay(submissionId, requesterId);
  }

  // Reads the posts for the record, then pays this one creator — never the others on
  // the campaign, whose new views wait for the brand to pay them too.
  private async recordAndPay(submissionId: string, requesterId: string): Promise<ApprovalResult> {
    const submission = await this.submissions.withLatestLink(submissionId);
    const campaign = await this.campaigns.requireCampaign(submission.campaignId);
    try {
      const { results } = await this.tracking.syncSubmission(submissionId, requesterId);
      const paid = await this.settlement.payCreator(campaign, submission.creatorUserId);
      return {
        submissionId,
        results,
        currencyCode: campaign.currencyCode,
        paidNowMinor: paid.creditedNowMinor,
        views: paid.views,
        payoutDeferred: false,
      };
    } catch (error) {
      // An approval is already saved; the brand can pay from the submission later.
      this.logger.error(`Paying for ${submissionId} failed: ${String(error)}`);
      return {
        submissionId,
        results: [],
        currencyCode: campaign.currencyCode,
        paidNowMinor: 0,
        views: 0,
        payoutDeferred: true,
      };
    }
  }
}
