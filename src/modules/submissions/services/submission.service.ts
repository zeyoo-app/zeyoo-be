import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Campaign,
  Review,
  SocialPlatform,
  Submission,
  SubmissionContentType,
  SubmissionPost,
  SubmissionRevision,
  SubmissionStatus,
} from '@prisma/client';
import { PrismaService } from '@platform/database/prisma.service';
import { AppPaths } from '@platform/links';
import { ApplicationService } from '@modules/applications/applications.public';
import { CampaignService } from '@modules/campaigns/campaigns.public';
import { OrganizationService } from '@modules/iam/iam.public';
import { CreatorProfileService, CreatorSummary } from '@modules/creators/creators.public';
import { UploadsService } from '@modules/media/media.public';
import { NotificationService } from '@modules/notifications/notifications.public';
import { parsePostUrl } from '@modules/social/social.public';
import { SubmitContentDto } from '../dto/submit-content.dto';

export type RevisionWithPosts = SubmissionRevision & { posts: SubmissionPost[] };
export type SubmissionWithRevisions = Submission & { revisions: RevisionWithPosts[] };
export type SubmissionDetail = SubmissionWithRevisions & { reviews: Review[] };

/** A submission as a brand sees it: who made it, and whether those accounts are verified. */
export type SubmissionForReview = SubmissionWithRevisions & {
  creator: Pick<CreatorSummary, 'displayName' | 'username' | 'avatarUrl'> | null;
  /** Every post is on a platform the creator proved they own by signing in to it. */
  accountVerified: boolean;
  /** The latest posts' platforms the creator has a verified account on. */
  verifiedPlatforms: SocialPlatform[];
};

/** Posts come back in a fixed order (oldest first) so clients list them consistently. */
const REVISIONS_WITH_POSTS = {
  orderBy: { createdAt: 'asc' },
  include: { posts: { orderBy: { createdAt: 'asc' } } },
} as const;

interface PostInput {
  platform: SocialPlatform;
  url: string;
}

@Injectable()
export class SubmissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly campaigns: CampaignService,
    private readonly organizations: OrganizationService,
    private readonly applications: ApplicationService,
    private readonly profiles: CreatorProfileService,
    private readonly uploads: UploadsService,
    private readonly notifications: NotificationService,
  ) {}

  async submit(
    campaignId: string,
    creatorUserId: string,
    dto: SubmitContentDto,
  ): Promise<SubmissionWithRevisions> {
    await this.assertNoExistingSubmission(campaignId, creatorUserId);
    await this.assertUploadIsOwn(creatorUserId, dto);
    // Submitting is how a creator joins; the brand approves or rejects the content.
    await this.applications.joinBySubmitting(campaignId, creatorUserId, dto.acceptedTerms);
    const campaign = await this.campaigns.requireCampaign(campaignId);
    const created = await this.prisma.submission.create({
      data: { campaignId, creatorUserId, revisions: { create: toRevisionData(dto, campaign) } },
      include: { revisions: REVISIONS_WITH_POSTS },
    });
    await this.tellBrandTeam(campaignId, creatorUserId, 'submitted content to');
    return created;
  }

  async resubmit(
    submissionId: string,
    creatorUserId: string,
    dto: SubmitContentDto,
  ): Promise<SubmissionWithRevisions> {
    const submission = await this.requireSubmission(submissionId);
    if (submission.creatorUserId !== creatorUserId) {
      throw new ForbiddenException('You can only revise your own submission.');
    }
    if (submission.status !== 'NEEDS_CHANGES') {
      throw new ConflictException('A revision can only be submitted when changes are requested.');
    }
    await this.assertUploadIsOwn(creatorUserId, dto);
    const campaign = await this.campaigns.requireCampaign(submission.campaignId);
    const revised = await this.prisma.submission.update({
      where: { id: submission.id },
      data: { status: 'PENDING', revisions: { create: toRevisionData(dto, campaign) } },
      include: { revisions: REVISIONS_WITH_POSTS },
    });
    await this.tellBrandTeam(submission.campaignId, creatorUserId, 'sent a revision for');
    return revised;
  }

  /** New content to review is news for everyone on the brand's team (contract §1.6). */
  private async tellBrandTeam(
    campaignId: string,
    creatorUserId: string,
    action: string,
  ): Promise<void> {
    const campaign = await this.campaigns.requireCampaign(campaignId);
    const [summary] = (await this.profiles.summariesByUserIds([creatorUserId])).values();
    const memberIds = await this.organizations.memberUserIds(campaign.organizationId);
    await Promise.all(
      memberIds.map((userId) =>
        this.notifications.notify({
          userId,
          type: 'SUBMISSION_RECEIVED',
          title: 'New submission to review',
          body: `${summary?.displayName ?? 'A creator'} ${action} "${campaign.title}".`,
          link: AppPaths.brandCampaign(campaign.id),
        }),
      ),
    );
  }

  async getById(submissionId: string, requesterId: string): Promise<SubmissionDetail> {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: { revisions: REVISIONS_WITH_POSTS, reviews: { orderBy: { createdAt: 'asc' } } },
    });
    if (!submission) {
      throw new NotFoundException('Submission not found.');
    }
    await this.assertCanView(submission, requesterId);
    return submission;
  }

  async listForCampaign(campaignId: string, requesterId: string): Promise<SubmissionForReview[]> {
    const campaign = await this.campaigns.requireCampaign(campaignId);
    await this.organizations.assertMember(campaign.organizationId, requesterId);
    const submissions = await this.prisma.submission.findMany({
      where: { campaignId },
      include: {
        revisions: REVISIONS_WITH_POSTS,
        // The latest note explains a change request or rejection on the brand's screens too.
        reviews: {
          orderBy: { createdAt: 'asc' },
          select: { decision: true, note: true, createdAt: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    const creators = await this.profiles.summariesByUserIds(
      submissions.map((submission) => submission.creatorUserId),
    );
    return submissions.map((submission) => {
      const creator = creators.get(submission.creatorUserId) ?? null;
      const verifiedPlatforms = verifiedPlatformsOf(submission, creator);
      const posts = latestPosts(submission);
      return {
        ...submission,
        creator: creator && toPublicCreator(creator),
        accountVerified:
          posts.length > 0 && posts.every((post) => verifiedPlatforms.includes(post.platform)),
        verifiedPlatforms,
      };
    });
  }

  // Reviews come along so the creator sees why changes were requested or it was rejected.
  listOwn(creatorUserId: string): Promise<SubmissionWithRevisions[]> {
    return this.prisma.submission.findMany({
      where: { creatorUserId },
      include: {
        revisions: REVISIONS_WITH_POSTS,
        // Only what the creator needs: not who on the brand's team reviewed it.
        reviews: {
          orderBy: { createdAt: 'asc' },
          select: { decision: true, note: true, createdAt: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async campaignIdsForCreator(creatorUserId: string): Promise<string[]> {
    const submissions = await this.prisma.submission.findMany({
      where: { creatorUserId },
      select: { campaignId: true },
    });
    return submissions.map((submission) => submission.campaignId);
  }

  async summaryForCampaign(campaignId: string): Promise<{ total: number; approved: number }> {
    const [total, approved] = await Promise.all([
      this.prisma.submission.count({ where: { campaignId } }),
      this.prisma.submission.count({ where: { campaignId, status: 'APPROVED' } }),
    ]);
    return { total, approved };
  }

  /** Approved submissions with the posts their creator most recently submitted. */
  async approvedWithLatestLink(campaignId: string): Promise<SubmissionLink[]> {
    const approved = await this.prisma.submission.findMany({
      where: { campaignId, status: 'APPROVED' },
      select: {
        id: true,
        campaignId: true,
        creatorUserId: true,
        revisions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: LATEST_REVISION_FIELDS,
        },
      },
    });
    return approved.map((submission) => toSubmissionLink(submission));
  }

  async withLatestLink(submissionId: string): Promise<SubmissionLink> {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      select: {
        id: true,
        campaignId: true,
        creatorUserId: true,
        status: true,
        revisions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: LATEST_REVISION_FIELDS,
        },
      },
    });
    if (!submission) {
      throw new NotFoundException('Submission not found.');
    }
    return { ...toSubmissionLink(submission), status: submission.status };
  }

  async approvedCreatorIds(campaignId: string): Promise<string[]> {
    const approved = await this.prisma.submission.findMany({
      where: { campaignId, status: 'APPROVED' },
      select: { creatorUserId: true },
    });
    return approved.map((submission) => submission.creatorUserId);
  }

  async requireSubmission(submissionId: string): Promise<Submission> {
    const submission = await this.prisma.submission.findUnique({ where: { id: submissionId } });
    if (!submission) {
      throw new NotFoundException('Submission not found.');
    }
    return submission;
  }

  private async assertNoExistingSubmission(
    campaignId: string,
    creatorUserId: string,
  ): Promise<void> {
    const existing = await this.prisma.submission.findUnique({
      where: { campaignId_creatorUserId: { campaignId, creatorUserId } },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('A submission already exists; submit a revision instead.');
    }
  }

  private async assertCanView(submission: Submission, requesterId: string): Promise<void> {
    if (submission.creatorUserId === requesterId) {
      return;
    }
    const campaign = await this.campaigns.requireCampaign(submission.campaignId);
    if (!(await this.organizations.isMember(campaign.organizationId, requesterId))) {
      throw new ForbiddenException('You do not have access to this submission.');
    }
  }

  /** An "upload" must be a video this creator uploaded through Zeyoo, not any URL. */
  private async assertUploadIsOwn(creatorUserId: string, dto: SubmitContentDto): Promise<void> {
    if (dto.contentType === 'UPLOAD' && dto.contentUrl) {
      await this.uploads.assertOwnReadyVideo(creatorUserId, dto.contentUrl);
    }
  }
}

/**
 * The revision to store. `contentUrl` stays filled for clients that read one link: the
 * uploaded video, or the first post.
 */
function toRevisionData(
  dto: SubmitContentDto,
  campaign: Campaign,
): {
  contentType: SubmitContentDto['contentType'];
  contentUrl: string;
  note: string | null;
  posts: { create: PostInput[] };
} {
  const posts = dto.contentType === 'LINK' ? resolvePosts(dto, campaign) : [];
  return {
    contentType: dto.contentType,
    contentUrl: dto.contentType === 'LINK' ? posts[0].url : (dto.contentUrl as string),
    note: dto.note ?? null,
    posts: { create: posts },
  };
}

/**
 * The posts of a LINK submission, each on one of the campaign's platforms. A link the
 * views sync recognises must be filed under its own platform; one it can't read (a
 * short link, say) is taken on the creator's word. An older client's single
 * `contentUrl` is filed under its recognised platform, or the campaign's main one.
 */
function resolvePosts(dto: SubmitContentDto, campaign: Campaign): PostInput[] {
  if (!dto.posts) {
    const url = dto.contentUrl as string;
    return [{ platform: parsePostUrl(url)?.platform ?? campaign.platform, url }];
  }
  const allowed = campaignPlatforms(campaign);
  return dto.posts.map((post) => {
    if (!allowed.includes(post.platform)) {
      throw new BadRequestException(
        `This campaign does not include ${PLATFORM_NAMES[post.platform]}.`,
      );
    }
    const recognised = parsePostUrl(post.url)?.platform;
    if (recognised && recognised !== post.platform) {
      throw new BadRequestException(
        `The ${PLATFORM_NAMES[post.platform]} link is a post on ${PLATFORM_NAMES[recognised]}.`,
      );
    }
    return { platform: post.platform, url: post.url.trim() };
  });
}

function campaignPlatforms(campaign: Campaign): SocialPlatform[] {
  return campaign.platforms.length > 0 ? campaign.platforms : [campaign.platform];
}

const PLATFORM_NAMES: Record<SocialPlatform, string> = {
  TIKTOK: 'TikTok',
  INSTAGRAM: 'Instagram',
  SNAPCHAT: 'Snapchat',
  YOUTUBE: 'YouTube',
  X: 'X',
  FACEBOOK: 'Facebook',
};

const LATEST_REVISION_FIELDS = {
  contentType: true,
  posts: { select: { platform: true, url: true }, orderBy: { createdAt: 'asc' } },
} as const;

export interface SubmissionLink {
  submissionId: string;
  campaignId: string;
  creatorUserId: string;
  status?: SubmissionStatus;
  /** Whether the latest revision is an uploaded video rather than published posts. */
  isUpload: boolean;
  /** The published posts in the latest revision; empty for an upload. */
  posts: PostInput[];
}

function toSubmissionLink(submission: {
  id: string;
  campaignId: string;
  creatorUserId: string;
  revisions: { contentType: SubmissionContentType; posts: PostInput[] }[];
}): SubmissionLink {
  const latest = submission.revisions[0];
  return {
    submissionId: submission.id,
    campaignId: submission.campaignId,
    creatorUserId: submission.creatorUserId,
    isUpload: latest?.contentType === 'UPLOAD',
    posts: latest?.posts ?? [],
  };
}

function latestPosts(submission: SubmissionWithRevisions): SubmissionPost[] {
  return submission.revisions[submission.revisions.length - 1]?.posts ?? [];
}

function toPublicCreator(
  creator: CreatorSummary,
): Pick<CreatorSummary, 'displayName' | 'username' | 'avatarUrl'> {
  return {
    displayName: creator.displayName,
    username: creator.username,
    avatarUrl: creator.avatarUrl,
  };
}

function verifiedPlatformsOf(
  submission: SubmissionWithRevisions,
  creator: CreatorSummary | null,
): SocialPlatform[] {
  if (!creator) {
    return [];
  }
  return latestPosts(submission)
    .map((post) => post.platform)
    .filter((platform) =>
      creator.accounts.some((account) => account.platform === platform && account.verified),
    );
}
