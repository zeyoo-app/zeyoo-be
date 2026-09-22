import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ReviewDecision, Submission, SubmissionStatus } from '@prisma/client';
import { PrismaService } from '@platform/database/prisma.service';
import { CampaignService } from '@modules/campaigns/campaigns.public';
import { OrganizationService } from '@modules/iam/iam.public';
import { ReviewSubmissionDto } from '../dto/review-submission.dto';
import { SubmissionService } from './submission.service';

const STATUS_BY_DECISION: Record<ReviewDecision, SubmissionStatus> = {
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CHANGES_REQUESTED: 'NEEDS_CHANGES',
};

@Injectable()
export class ReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly submissions: SubmissionService,
    private readonly campaigns: CampaignService,
    private readonly organizations: OrganizationService,
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
