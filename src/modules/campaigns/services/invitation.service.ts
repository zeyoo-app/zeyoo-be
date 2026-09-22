import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Campaign, CampaignInvitation } from '@prisma/client';
import { PrismaService } from '@platform/database/prisma.service';
import { OrganizationService, UserService } from '@modules/iam/iam.public';

@Injectable()
export class InvitationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizations: OrganizationService,
    private readonly users: UserService,
  ) {}

  async invite(
    campaignId: string,
    requesterId: string,
    creatorEmail: string,
  ): Promise<CampaignInvitation> {
    const campaign = await this.loadManageable(campaignId, requesterId);
    if (campaign.status === 'CLOSED') {
      throw new ConflictException('Cannot invite creators to a closed campaign.');
    }

    const creator = await this.users.findByEmail(creatorEmail);
    if (!creator) {
      throw new NotFoundException('No user with this email exists.');
    }
    if (creator.type !== 'CREATOR') {
      throw new BadRequestException('Only creator accounts can be invited.');
    }

    await this.assertNotAlreadyInvited(campaignId, creator.id);
    return this.prisma.campaignInvitation.create({
      data: { campaignId, creatorUserId: creator.id, invitedByUserId: requesterId },
    });
  }

  async listForCampaign(campaignId: string, requesterId: string): Promise<CampaignInvitation[]> {
    await this.loadManageable(campaignId, requesterId);
    return this.prisma.campaignInvitation.findMany({
      where: { campaignId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revoke(campaignId: string, requesterId: string, invitationId: string): Promise<void> {
    await this.loadManageable(campaignId, requesterId);
    const invitation = await this.getInvitationInCampaign(campaignId, invitationId);
    if (invitation.status !== 'PENDING') {
      throw new ConflictException('Only a pending invitation can be revoked.');
    }
    await this.prisma.campaignInvitation.update({
      where: { id: invitation.id },
      data: { status: 'REVOKED', respondedAt: new Date() },
    });
  }

  private async loadManageable(campaignId: string, requesterId: string): Promise<Campaign> {
    const campaign = await this.prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) {
      throw new NotFoundException('Campaign not found.');
    }
    await this.organizations.assertMember(campaign.organizationId, requesterId);
    return campaign;
  }

  private async assertNotAlreadyInvited(campaignId: string, creatorUserId: string): Promise<void> {
    const existing = await this.prisma.campaignInvitation.findUnique({
      where: { campaignId_creatorUserId: { campaignId, creatorUserId } },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('This creator has already been invited.');
    }
  }

  private async getInvitationInCampaign(
    campaignId: string,
    invitationId: string,
  ): Promise<CampaignInvitation> {
    const invitation = await this.prisma.campaignInvitation.findUnique({
      where: { id: invitationId },
    });
    if (!invitation || invitation.campaignId !== campaignId) {
      throw new NotFoundException('Invitation not found in this campaign.');
    }
    return invitation;
  }
}
