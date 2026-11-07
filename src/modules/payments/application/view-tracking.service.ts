import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { MetricSource, SocialPlatform } from '@prisma/client';
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
  /** Which post the count is for; may be left out when the submission has one post. */
  platform?: SocialPlatform;
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
  /** The post this result is about; null when the submission has no post to read. */
  platform: SocialPlatform | null;
  outcome: SyncOutcome;
}

/** A submission's posts with the latest reading of each, for a brand reviewing it. */
export interface SubmissionViews {
  submissionId: string;
  posts: PostViews[];
}

export interface PostViews {
  platform: SocialPlatform;
  /** Null when views were entered for an uploaded video rather than a published post. */
  url: string | null;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  source: MetricSource | null;
  /** When the latest reading was taken; null when none has been recorded yet. */
  capturedAt: Date | null;
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
    const platform = this.manualPlatform(submission, campaign.platform, input.platform);
    await this.metrics.recordSnapshot({
      campaignId: campaign.id,
      creatorUserId: submission.creatorUserId,
      submissionId,
      platform,
      source: 'MANUAL',
      metrics: toUnified(input),
    });
    return {
      results: [
        { submissionId, platform, outcome: { status: 'RECORDED', platform, views: input.views } },
      ],
      settlement: await this.settlement.settleCampaignAsSystem(campaign.id),
    };
  }

  async syncSubmission(submissionId: string, requesterId: string): Promise<TrackingResult> {
    const submission = await this.submissions.withLatestLink(submissionId);
    await this.assertCanManage(submission.campaignId, requesterId);
    if (submission.status !== 'APPROVED') {
      throw new ConflictException('Views can only be synced for an approved submission.');
    }
    const results = await this.pullFromPlatform(submission);
    return {
      results,
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
      results.push(...(await this.pullFromPlatform(submission)));
    }
    return { results, settlement: await this.settlement.settleCampaignAsSystem(campaignId) };
  }

  /** The latest reading of each post in a submission, for the brand reviewing it. */
  async getSubmissionViews(submissionId: string, requesterId: string): Promise<SubmissionViews> {
    const submission = await this.submissions.withLatestLink(submissionId);
    await this.assertCanManage(submission.campaignId, requesterId);
    const latest = await this.metrics.latestByPlatformForCreator(
      submission.campaignId,
      submission.creatorUserId,
    );
    // An upload has no posts; any views a brand entered for it are still shown.
    const posts =
      submission.posts.length > 0
        ? submission.posts
        : [...latest.keys()].map((platform) => ({ platform, url: null }));
    return {
      submissionId,
      posts: posts.map(({ platform, url }) => {
        const reading = latest.get(platform);
        return {
          platform,
          url,
          views: reading?.views ?? 0,
          likes: reading?.likes ?? 0,
          comments: reading?.comments ?? 0,
          shares: reading?.shares ?? 0,
          source: reading?.source ?? null,
          capturedAt: reading?.capturedAt ?? null,
        };
      }),
    };
  }

  /** Reads every post in the submission; one post failing doesn't stop the others. */
  private async pullFromPlatform(submission: SubmissionLink): Promise<SubmissionSyncResult[]> {
    const { submissionId } = submission;
    if (submission.posts.length === 0) {
      return [
        unavailable(
          submissionId,
          null,
          'UNSUPPORTED_PLATFORM',
          'This submission has no post link; enter views manually.',
        ),
      ];
    }
    const results: SubmissionSyncResult[] = [];
    for (const post of submission.posts) {
      results.push(await this.pullPost(submission, post));
    }
    return results;
  }

  private async pullPost(
    submission: SubmissionLink,
    post: { platform: SocialPlatform; url: string },
  ): Promise<SubmissionSyncResult> {
    const { submissionId } = submission;
    try {
      const { metrics } = await this.platformMetrics.fetchForPost(
        post.url,
        submission.creatorUserId,
      );
      // Filed under the platform the creator chose, so it lines up with the post.
      await this.metrics.recordSnapshot({
        campaignId: submission.campaignId,
        creatorUserId: submission.creatorUserId,
        submissionId,
        platform: post.platform,
        source: 'PLATFORM_API',
        metrics,
      });
      return {
        submissionId,
        platform: post.platform,
        outcome: { status: 'RECORDED', platform: post.platform, views: metrics.views },
      };
    } catch (error) {
      if (error instanceof MetricsUnavailableError) {
        return unavailable(submissionId, post.platform, error.reason, error.message);
      }
      throw error;
    }
  }

  /**
   * The post a typed-in count belongs to. It must be one of the submission's posts; with a
   * single post (or an uploaded video, counted on the campaign's main platform) it may be
   * left out.
   */
  private manualPlatform(
    submission: SubmissionLink,
    fallback: SocialPlatform,
    requested: SocialPlatform | undefined,
  ): SocialPlatform {
    const platforms = submission.posts.map((post) => post.platform);
    if (platforms.length === 0) {
      if (requested && requested !== fallback) {
        throw new BadRequestException('This submission has no post on that platform.');
      }
      return fallback;
    }
    if (!requested) {
      if (platforms.length > 1) {
        throw new BadRequestException('Choose which post these views are for.');
      }
      return platforms[0];
    }
    if (!platforms.includes(requested)) {
      throw new BadRequestException('This submission has no post on that platform.');
    }
    return requested;
  }

  private async assertCanManage(campaignId: string, requesterId: string): Promise<void> {
    const campaign = await this.campaigns.requireCampaign(campaignId);
    await this.organizations.assertMember(campaign.organizationId, requesterId);
  }
}

function unavailable(
  submissionId: string,
  platform: SocialPlatform | null,
  reason: MetricsUnavailableReason,
  message: string,
): SubmissionSyncResult {
  return { submissionId, platform, outcome: { status: 'UNAVAILABLE', reason, message } };
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
