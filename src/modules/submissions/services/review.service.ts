import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ReviewDecision, Submission, SubmissionStatus } from '@prisma/client';
import { PrismaService } from '@platform/database/prisma.service';
import { CampaignService } from '@modules/campaigns/campaigns.public';
import { OrganizationService } from '@modules/iam/iam.public';
import { NotificationService } from '@modules/notifications/notifications.public';
import { ReviewSubmissionDto } from '../dto/review-submission.dto';
import { SubmissionService } from './submission.service';

const STATUS_BY_DECISION: Record<ReviewDecision, SubmissionStatus> = {
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CHANGES_REQUESTED: 'NEEDS_CHANGES',
};

const REVIEW_TITLE: Record<ReviewDecision, string> = {
  APPROVED: 'Your submission was approved',
  REJECTED: 'Your submission was rejected',
  CHANGES_REQUESTED: 'Changes were requested on your submission',
};

@Injectable()
export class ReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly submissions: SubmissionService,
    private readonly campaigns: CampaignService,
    private readonly organizations: OrganizationService,
    private readonly notifications: NotificationService,
  ) {}

  async review(
    submissionId: string,
    reviewerUserId: string,
    dto: ReviewSubmissionDto,
  ): Promise<Submission> {
    const submission = await this.submissions.requireSubmission(submissionId);
    await this.assertReviewer(submission, reviewerUserId);
    if (submission.status !== 'PENDING') {
      throw new ConflictException('Only a pending submission can be reviewed.');
    }

    const revisionId = await this.latestRevisionId(submissionId);
    const [, updated] = await this.prisma.$transaction([
      this.prisma.review.create({
        data: {
          submissionId,
          revisionId,
          reviewerUserId,
          decision: dto.decision,
          note: dto.note ?? null,
        },
      }),
      this.prisma.submission.update({
        where: { id: submissionId },
        data: { status: STATUS_BY_DECISION[dto.decision] },
      }),
    ]);
    await this.notifications.notify({
      userId: submission.creatorUserId,
      type: 'SUBMISSION_REVIEWED',
      title: REVIEW_TITLE[dto.decision],
      body: dto.note ?? 'Open the campaign to see the details.',
    });
    return updated;
  }

  /** A platform admin's ruling on an appeal; recorded as a review like any other. */
  async overrideAsAdmin(
    submissionId: string,
    adminUserId: string,
    decision: ReviewDecision,
    note: string,
  ): Promise<Submission> {
    const submission = await this.submissions.requireSubmission(submissionId);
    const revisionId = await this.latestRevisionId(submissionId);
    const [, updated] = await this.prisma.$transaction([
      this.prisma.review.create({
        data: { submissionId, revisionId, reviewerUserId: adminUserId, decision, note },
      }),
      this.prisma.submission.update({
        where: { id: submission.id },
        data: { status: STATUS_BY_DECISION[decision] },
      }),
    ]);
    return updated;
  }

  private async assertReviewer(submission: Submission, reviewerUserId: string): Promise<void> {
    const campaign = await this.campaigns.requireCampaign(submission.campaignId);
    await this.organizations.assertMember(campaign.organizationId, reviewerUserId);
  }

  private async latestRevisionId(submissionId: string): Promise<string> {
    const revision = await this.prisma.submissionRevision.findFirst({
      where: { submissionId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!revision) {
      throw new NotFoundException('Submission has no content to review.');
    }
    return revision.id;
  }
}
