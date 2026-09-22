import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Application, ApplicationStatus, Campaign } from '@prisma/client';
import { PrismaService } from '@platform/database/prisma.service';
import { CampaignService, InvitationService } from '@modules/campaigns/campaigns.public';
import { OrganizationService } from '@modules/iam/iam.public';
import { ApplyToCampaignDto } from '../dto/apply.dto';

type ReviewOutcome = Extract<ApplicationStatus, 'APPROVED' | 'DECLINED'>;

@Injectable()
export class ApplicationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly campaigns: CampaignService,
    private readonly invitations: InvitationService,
    private readonly organizations: OrganizationService,
  ) {}

  async apply(
    campaignId: string,
    creatorUserId: string,
    dto: ApplyToCampaignDto,
  ): Promise<Application> {
    const campaign = await this.campaigns.requireCampaign(campaignId);
    this.assertOpenForApplications(campaign);
    const fromInvitation = await this.resolveInvitationEligibility(campaign, creatorUserId);
    await this.assertNotAlreadyApplied(campaignId, creatorUserId);

    const application = await this.prisma.application.create({
      data: {
        campaignId,
        creatorUserId,
        source: fromInvitation ? 'INVITATION' : 'DIRECT',
        acceptedTerms: dto.acceptedTerms,
        message: dto.message ?? null,
      },
    });
    if (fromInvitation) {
      await this.invitations.markAccepted(campaignId, creatorUserId);
    }
    return application;
  }

  listOwn(creatorUserId: string): Promise<Application[]> {
    return this.prisma.application.findMany({
      where: { creatorUserId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async hasApprovedApplication(campaignId: string, creatorUserId: string): Promise<boolean> {
    const application = await this.prisma.application.findUnique({
      where: { campaignId_creatorUserId: { campaignId, creatorUserId } },
      select: { status: true },
    });
    return application?.status === 'APPROVED';
  }

  async withdraw(applicationId: string, creatorUserId: string): Promise<Application> {
    const application = await this.loadOrThrow(applicationId);
    if (application.creatorUserId !== creatorUserId) {
      throw new ForbiddenException('You can only withdraw your own application.');
    }
    if (application.status !== 'PENDING') {
      throw new ConflictException('Only a pending application can be withdrawn.');
    }
    return this.prisma.application.update({
      where: { id: application.id },
      data: { status: 'WITHDRAWN' },
    });
  }

  async listForCampaign(campaignId: string, requesterId: string): Promise<Application[]> {
    const campaign = await this.campaigns.requireCampaign(campaignId);
    await this.organizations.assertMember(campaign.organizationId, requesterId);
    return this.prisma.application.findMany({
      where: { campaignId },
      orderBy: { createdAt: 'desc' },
    });
  }

  approve(applicationId: string, requesterId: string): Promise<Application> {
    return this.review(applicationId, requesterId, 'APPROVED');
  }

  decline(applicationId: string, requesterId: string): Promise<Application> {
    return this.review(applicationId, requesterId, 'DECLINED');
  }

  private async review(
    applicationId: string,
    requesterId: string,
    outcome: ReviewOutcome,
  ): Promise<Application> {
    const application = await this.loadOrThrow(applicationId);
    const campaign = await this.campaigns.requireCampaign(application.campaignId);
    await this.organizations.assertMember(campaign.organizationId, requesterId);
    if (application.status !== 'PENDING') {
      throw new ConflictException('Only a pending application can be reviewed.');
    }
    return this.prisma.application.update({
      where: { id: application.id },
      data: { status: outcome, decidedByUserId: requesterId, decidedAt: new Date() },
    });
  }

  private assertOpenForApplications(campaign: Campaign): void {
    if (campaign.status !== 'PUBLISHED') {
      throw new ConflictException('This campaign is not open for applications.');
    }
  }

  private async resolveInvitationEligibility(
    campaign: Campaign,
    creatorUserId: string,
  ): Promise<boolean> {
    if (campaign.visibility === 'PUBLIC') {
      return false;
    }
    const invited = await this.invitations.hasPendingInvitation(campaign.id, creatorUserId);
    if (!invited) {
      throw new ForbiddenException('This campaign is private; an invitation is required to apply.');
    }
    return true;
  }

  private async assertNotAlreadyApplied(campaignId: string, creatorUserId: string): Promise<void> {
    const existing = await this.prisma.application.findUnique({
      where: { campaignId_creatorUserId: { campaignId, creatorUserId } },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('You have already applied to this campaign.');
    }
  }

  private async loadOrThrow(applicationId: string): Promise<Application> {
    const application = await this.prisma.application.findUnique({ where: { id: applicationId } });
    if (!application) {
      throw new NotFoundException('Application not found.');
    }
    return application;
  }
}
