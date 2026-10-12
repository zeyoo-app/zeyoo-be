import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Review,
  Submission,
  SubmissionContentType,
  SubmissionRevision,
  SubmissionStatus,
} from '@prisma/client';
import { PrismaService } from '@platform/database/prisma.service';
import { ApplicationService } from '@modules/applications/applications.public';
import { CampaignService } from '@modules/campaigns/campaigns.public';
import { OrganizationService } from '@modules/iam/iam.public';
import { CreatorProfileService, CreatorSummary } from '@modules/creators/creators.public';
import { parsePostUrl } from '@modules/social/social.public';
import { SubmitContentDto } from '../dto/submit-content.dto';

export type SubmissionWithRevisions = Submission & { revisions: SubmissionRevision[] };
export type SubmissionDetail = SubmissionWithRevisions & { reviews: Review[] };

/** A submission as a brand sees it: who made it, and whether that account is verified. */
export type SubmissionForReview = SubmissionWithRevisions & {
  creator: Pick<CreatorSummary, 'displayName' | 'username' | 'avatarUrl'> | null;
  /** The post's platform is one the creator proved they own by signing in to it. */
  accountVerified: boolean;
};

@Injectable()
export class SubmissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly campaigns: CampaignService,
    private readonly organizations: OrganizationService,
    private readonly applications: ApplicationService,
    private readonly profiles: CreatorProfileService,
  ) {}

  async submit(
    campaignId: string,
    creatorUserId: string,
    dto: SubmitContentDto,
  ): Promise<SubmissionWithRevisions> {
    await this.assertApprovedToSubmit(campaignId, creatorUserId);
    await this.assertNoExistingSubmission(campaignId, creatorUserId);
    return this.prisma.submission.create({
      data: { campaignId, creatorUserId, revisions: { create: this.toRevisionData(dto) } },
      include: { revisions: true },
    });
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
    return this.prisma.submission.update({
      where: { id: submission.id },
      data: { status: 'PENDING', revisions: { create: this.toRevisionData(dto) } },
      include: { revisions: true },
    });
  }

  async getById(submissionId: string, requesterId: string): Promise<SubmissionDetail> {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: { revisions: true, reviews: true },
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
      include: { revisions: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
    const creators = await this.profiles.summariesByUserIds(
      submissions.map((submission) => submission.creatorUserId),
    );
    return submissions.map((submission) => {
      const creator = creators.get(submission.creatorUserId) ?? null;
      return {
        ...submission,
        creator: creator && toPublicCreator(creator),
        accountVerified: isVerified(submission, creator),
      };
    });
  }

  listOwn(creatorUserId: string): Promise<SubmissionWithRevisions[]> {
    return this.prisma.submission.findMany({
      where: { creatorUserId },
      include: { revisions: { orderBy: { createdAt: 'asc' } } },
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

  /** Approved submissions with the link their creator most recently submitted, if any. */
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
          select: { contentType: true, contentUrl: true },
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
          select: { contentType: true, contentUrl: true },
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

  private async assertApprovedToSubmit(campaignId: string, creatorUserId: string): Promise<void> {
    const approved = await this.applications.hasApprovedApplication(campaignId, creatorUserId);
    if (!approved) {
      throw new ForbiddenException('An approved application is required to submit content.');
    }
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

  private toRevisionData(dto: SubmitContentDto): {
    contentType: SubmitContentDto['contentType'];
    contentUrl: string;
    note: string | null;
  } {
    return { contentType: dto.contentType, contentUrl: dto.contentUrl, note: dto.note ?? null };
  }
}

export interface SubmissionLink {
  submissionId: string;
  campaignId: string;
  creatorUserId: string;
  status?: SubmissionStatus;
  /** Only a LINK revision points at a post a platform can be asked about. */
  postUrl: string | null;
}

function toSubmissionLink(submission: {
  id: string;
  campaignId: string;
  creatorUserId: string;
  revisions: { contentType: SubmissionContentType; contentUrl: string }[];
}): SubmissionLink {
  const latest = submission.revisions[0];
  return {
    submissionId: submission.id,
    campaignId: submission.campaignId,
    creatorUserId: submission.creatorUserId,
    postUrl: latest?.contentType === 'LINK' ? latest.contentUrl : null,
  };
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

function isVerified(submission: SubmissionWithRevisions, creator: CreatorSummary | null): boolean {
  const latest = submission.revisions[submission.revisions.length - 1];
  const post = latest?.contentType === 'LINK' ? parsePostUrl(latest.contentUrl) : null;
  if (!post || !creator) {
    return false;
  }
  return creator.accounts.some((account) => account.platform === post.platform && account.verified);
}
