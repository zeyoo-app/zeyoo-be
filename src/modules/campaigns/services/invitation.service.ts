import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Campaign, CampaignInvitation, User } from '@prisma/client';
import { PrismaService } from '@platform/database/prisma.service';
import { OrganizationService, UserService } from '@modules/iam/iam.public';
import { CreatorProfileService, CreatorSummary } from '@modules/creators/creators.public';
import { NotificationService } from '@modules/notifications/notifications.public';

export type InvitationWithCreator = CampaignInvitation & {
  creator: Pick<CreatorSummary, 'displayName' | 'username' | 'avatarUrl'> | null;
};

export interface InviteTarget {
  creatorEmail?: string;
  creatorUserId?: string;
}

@Injectable()
export class InvitationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizations: OrganizationService,
    private readonly users: UserService,
    private readonly notifications: NotificationService,
    private readonly profiles: CreatorProfileService,
  ) {}

  async invite(
    campaignId: string,
    requesterId: string,
    target: InviteTarget,
  ): Promise<CampaignInvitation> {
    const campaign = await this.loadManageable(campaignId, requesterId);
    if (campaign.status === 'CLOSED') {
      throw new ConflictException('Cannot invite creators to a closed campaign.');
    }

    const creator = await this.findCreator(target);
    if (!creator) {
      throw new NotFoundException('Creator not found.');
    }
    if (creator.type !== 'CREATOR') {
      throw new BadRequestException('Only creator accounts can be invited.');
    }

    await this.assertNotAlreadyInvited(campaignId, creator.id);
    const invitation = await this.prisma.campaignInvitation.create({
      data: { campaignId, creatorUserId: creator.id, invitedByUserId: requesterId },
    });
    await this.notifications.notify({
      userId: creator.id,
      type: 'CAMPAIGN_INVITE',
      title: 'You have been invited to a campaign',
      body: `You are invited to join "${campaign.title}".`,
    });
    return invitation;
  }

  async listForCampaign(campaignId: string, requesterId: string): Promise<InvitationWithCreator[]> {
    await this.loadManageable(campaignId, requesterId);
    const invitations = await this.prisma.campaignInvitation.findMany({
      where: { campaignId },
      orderBy: { createdAt: 'desc' },
    });
    const creators = await this.profiles.summariesByUserIds(
      invitations.map((invitation) => invitation.creatorUserId),
    );
    return invitations.map((invitation) => {
      const creator = creators.get(invitation.creatorUserId);
      return {
        ...invitation,
        creator: creator
          ? {
              displayName: creator.displayName,
              username: creator.username,
              avatarUrl: creator.avatarUrl,
            }
          : null,
      };
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

  async hasPendingInvitation(campaignId: string, creatorUserId: string): Promise<boolean> {
    const invitation = await this.prisma.campaignInvitation.findUnique({
      where: { campaignId_creatorUserId: { campaignId, creatorUserId } },
      select: { status: true },
    });
    return invitation?.status === 'PENDING';
  }

  // Called when a creator accepts an invitation by applying; idempotent.
  async markAccepted(campaignId: string, creatorUserId: string): Promise<void> {
    await this.prisma.campaignInvitation.updateMany({
      where: { campaignId, creatorUserId, status: 'PENDING' },
      data: { status: 'ACCEPTED', respondedAt: new Date() },
    });
  }

  private findCreator({ creatorEmail, creatorUserId }: InviteTarget): Promise<User | null> {
    return creatorUserId
      ? this.users.findById(creatorUserId)
      : this.users.findByEmail(creatorEmail!);
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
