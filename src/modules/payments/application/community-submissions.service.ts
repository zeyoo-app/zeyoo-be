import { Injectable } from '@nestjs/common';
import { CampaignService } from '@modules/campaigns/campaigns.public';
import { MetricService } from '@modules/social/social.public';
import { CommunitySubmission, SubmissionService } from '@modules/submissions/submissions.public';

export interface CommunitySubmissionView extends CommunitySubmission {
  /** The latest verified view count across the post's platforms. */
  views: number;
}

/**
 * A campaign's approved posts for anyone who may see the campaign — creators looking
 * for inspiration as well as the brand. It lives beside earnings because the view
 * counts come from the same readings.
 */
@Injectable()
export class CommunitySubmissionsService {
  constructor(
    private readonly campaigns: CampaignService,
    private readonly submissions: SubmissionService,
    private readonly metrics: MetricService,
  ) {}

  async list(campaignId: string, requesterId: string): Promise<CommunitySubmissionView[]> {
    // Throws for anyone who may not see the campaign (a private one they weren't invited to).
    await this.campaigns.getById(campaignId, requesterId);
    const [approved, readings] = await Promise.all([
      this.submissions.approvedForCommunity(campaignId),
      this.metrics.latestReadingsByCreator(campaignId),
    ]);
    return approved.map((submission) => ({
      ...submission,
      views: readings.get(submission.creatorUserId)?.views ?? 0,
    }));
  }
}
