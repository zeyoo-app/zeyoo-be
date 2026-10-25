import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Campaign } from '@prisma/client';
import { PrismaService } from '@platform/database/prisma.service';
import { OrganizationService } from '@modules/iam/iam.public';
import { CreateCampaignDto, UpdateCampaignDto } from '../dto/campaign.dto';
import { CategoryService } from './category.service';

/** What a brand may still change once creators can see and join the campaign. */
const LIVE_EDITABLE = new Set([
  'title',
  'description',
  'goals',
  'audience',
  'guidelines',
  'hashtags',
  'mentions',
  'referenceMaterials',
  'coverImageUrl',
  'categoryId',
  'endDate',
]);

@Injectable()
export class CampaignService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizations: OrganizationService,
    private readonly categories: CategoryService,
  ) {}

  async create(
    organizationId: string,
    actingUserId: string,
    dto: CreateCampaignDto,
  ): Promise<Campaign> {
    await this.organizations.assertMember(organizationId, actingUserId);
    await this.ensureCategoryExists(dto.categoryId);
    const platforms = [...new Set(dto.platforms ?? (dto.platform ? [dto.platform] : []))];
    return this.prisma.campaign.create({
      data: {
        ...dto,
        platform: platforms[0],
        platforms,
        organizationId,
        createdByUserId: actingUserId,
      },
    });
  }

  async listForOrganization(organizationId: string, requesterId: string): Promise<Campaign[]> {
    await this.organizations.assertMember(organizationId, requesterId);
    return this.prisma.campaign.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getById(campaignId: string, requesterId: string): Promise<Campaign> {
    const campaign = await this.loadOrThrow(campaignId);
    const isMember = await this.organizations.isMember(campaign.organizationId, requesterId);
    if (
      isMember ||
      this.isPubliclyVisible(campaign) ||
      (await this.isInvited(campaign, requesterId))
    ) {
      return campaign;
    }
    throw new ForbiddenException('You do not have access to this campaign.');
  }

  async update(campaignId: string, requesterId: string, dto: UpdateCampaignDto): Promise<Campaign> {
    const campaign = await this.loadManageable(campaignId, requesterId);
    this.assertEditable(campaign, dto);
    await this.ensureCategoryExists(dto.categoryId);
    this.assertSchedule(dto.startDate ?? campaign.startDate, dto.endDate ?? campaign.endDate);
    const platforms = dto.platforms ?? (dto.platform ? [dto.platform] : undefined);
    return this.prisma.campaign.update({
      where: { id: campaign.id },
      data: platforms ? { ...dto, platform: platforms[0], platforms } : dto,
    });
  }

  async publish(campaignId: string, requesterId: string): Promise<Campaign> {
    const campaign = await this.loadManageable(campaignId, requesterId);
    this.assertDraft(campaign);
    return this.prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
    });
  }

  async close(campaignId: string, requesterId: string): Promise<Campaign> {
    const campaign = await this.loadManageable(campaignId, requesterId);
    if (campaign.status !== 'PUBLISHED') {
      throw new ConflictException('Only a published campaign can be closed.');
    }
    return this.prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
  }

  /** Staff override: closes any published campaign regardless of organization. */
  async closeAsAdmin(campaignId: string): Promise<Campaign> {
    const campaign = await this.requireCampaign(campaignId);
    if (campaign.status !== 'PUBLISHED') {
      throw new ConflictException('Only a published campaign can be closed.');
    }
    return this.prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
  }

  // Every public campaign, plus the invite-only ones this creator has been invited to.
  discoverFor(creatorUserId: string): Promise<Campaign[]> {
    return this.prisma.campaign.findMany({
      where: {
        status: 'PUBLISHED',
        OR: [
          { visibility: 'PUBLIC' },
          { invitations: { some: { creatorUserId, status: 'PENDING' } } },
        ],
      },
      orderBy: { publishedAt: 'desc' },
    });
  }

  // For trusted inter-module callers (e.g. applications). Performs no access
  // control — the caller is responsible for authorizing the request.
  requireCampaign(campaignId: string): Promise<Campaign> {
    return this.loadOrThrow(campaignId);
  }

  findManyByIds(campaignIds: string[]): Promise<Campaign[]> {
    return this.prisma.campaign.findMany({ where: { id: { in: campaignIds } } });
  }

  async hasLiveCampaigns(organizationIds: string[]): Promise<boolean> {
    if (organizationIds.length === 0) {
      return false;
    }
    const live = await this.prisma.campaign.count({
      where: { organizationId: { in: organizationIds }, status: 'PUBLISHED' },
    });
    return live > 0;
  }

  listPublished(): Promise<Campaign[]> {
    return this.prisma.campaign.findMany({ where: { status: 'PUBLISHED' } });
  }

  listAll(): Promise<Campaign[]> {
    return this.prisma.campaign.findMany({ orderBy: { createdAt: 'desc' } });
  }

  private async loadManageable(campaignId: string, requesterId: string): Promise<Campaign> {
    const campaign = await this.loadOrThrow(campaignId);
    await this.organizations.assertMember(campaign.organizationId, requesterId);
    return campaign;
  }

  private async loadOrThrow(campaignId: string): Promise<Campaign> {
    const campaign = await this.prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) {
      throw new NotFoundException('Campaign not found.');
    }
    return campaign;
  }

  private async ensureCategoryExists(categoryId: string | undefined): Promise<void> {
    if (categoryId) {
      await this.categories.assertExists(categoryId);
    }
  }

  /**
   * A draft can change freely. A live campaign keeps the terms creators applied on —
   * money, reward, platforms, visibility, start — but its wording, requirements and
   * materials can be corrected, and it can run longer (never shorter).
   */
  private assertEditable(campaign: Campaign, dto: UpdateCampaignDto): void {
    if (campaign.status === 'DRAFT') {
      return;
    }
    if (campaign.status !== 'PUBLISHED') {
      throw new ConflictException('A closed campaign can no longer be edited.');
    }
    const locked = Object.keys(dto).filter(
      (key) => dto[key as keyof UpdateCampaignDto] !== undefined && !LIVE_EDITABLE.has(key),
    );
    if (locked.length > 0) {
      throw new ConflictException(
        `A live campaign's terms cannot change (${locked.join(', ')}). Close it and create a new one instead.`,
      );
    }
    if (dto.endDate && dto.endDate < campaign.endDate) {
      throw new ConflictException('A live campaign can be extended, not shortened.');
    }
  }

  private assertDraft(campaign: Campaign): void {
    if (campaign.status !== 'DRAFT') {
      throw new ConflictException('Only a draft campaign can be modified.');
    }
  }

  private assertSchedule(startDate: Date, endDate: Date): void {
    if (endDate <= startDate) {
      throw new BadRequestException('endDate must be after startDate.');
    }
  }

  private async isInvited(campaign: Campaign, creatorUserId: string): Promise<boolean> {
    if (campaign.status !== 'PUBLISHED') {
      return false;
    }
    const invitation = await this.prisma.campaignInvitation.findFirst({
      where: { campaignId: campaign.id, creatorUserId, status: 'PENDING' },
      select: { id: true },
    });
    return invitation !== null;
  }

  private isPubliclyVisible(campaign: Campaign): boolean {
    return campaign.status === 'PUBLISHED' && campaign.visibility === 'PUBLIC';
  }
}
