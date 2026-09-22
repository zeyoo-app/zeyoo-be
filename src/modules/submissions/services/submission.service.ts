import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Review, Submission, SubmissionRevision } from '@prisma/client';
import { PrismaService } from '@platform/database/prisma.service';
import { ApplicationService } from '@modules/applications/applications.public';
import { CampaignService } from '@modules/campaigns/campaigns.public';
import { OrganizationService } from '@modules/iam/iam.public';
import { SubmitContentDto } from '../dto/submit-content.dto';

export type SubmissionWithRevisions = Submission & { revisions: SubmissionRevision[] };
export type SubmissionDetail = SubmissionWithRevisions & { reviews: Review[] };

@Injectable()
export class SubmissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly campaigns: CampaignService,
    private readonly organizations: OrganizationService,
    private readonly applications: ApplicationService,
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

  async listForCampaign(campaignId: string, requesterId: string): Promise<Submission[]> {
    const campaign = await this.campaigns.requireCampaign(campaignId);
    await this.organizations.assertMember(campaign.organizationId, requesterId);
    return this.prisma.submission.findMany({
      where: { campaignId },
      orderBy: { createdAt: 'desc' },
    });
  }

  listOwn(creatorUserId: string): Promise<Submission[]> {
    return this.prisma.submission.findMany({
      where: { creatorUserId },
      orderBy: { createdAt: 'desc' },
    });
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
