import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Campaign } from '@prisma/client';
import { PrismaService } from '@platform/database/prisma.service';
import { EntitlementsService } from '@modules/entitlements/entitlements.public';
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

/** Runs after a campaign closes; `closedByUserId` is the brand member or staff who closed it. */
export type CampaignClosedListener = (campaign: Campaign, closedByUserId: string) => Promise<void>;

/** A campaign as its brand's team sees it, with its submission counts. */
export type CampaignWithCounts = Campaign & {
  submissionCount: number;
  /** Submissions waiting for the brand to approve, request changes or reject. */
  pendingSubmissionCount: number;
};

@Injectable()
export class CampaignService {
  private readonly logger = new Logger(CampaignService.name);
  private readonly closedListeners: CampaignClosedListener[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly organizations: OrganizationService,
    private readonly categories: CategoryService,
    private readonly entitlements: EntitlementsService,
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

  async listForOrganization(
    organizationId: string,
    requesterId: string,
  ): Promise<CampaignWithCounts[]> {
    await this.organizations.assertMember(organizationId, requesterId);
    const campaigns = await this.prisma.campaign.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
    return this.withSubmissionCounts(campaigns);
  }

  /** The brand's team also gets the campaign's submission counts; others get the campaign. */
  async getById(campaignId: string, requesterId: string): Promise<Campaign | CampaignWithCounts> {
    const campaign = await this.loadOrThrow(campaignId);
    const isMember = await this.organizations.isMember(campaign.organizationId, requesterId);
    if (isMember) {
      const [withCounts] = await this.withSubmissionCounts([campaign]);
      return withCounts;
    }
    if (
      this.isPubliclyVisible(campaign) ||
      (await this.isInvited(campaign, requesterId)) ||
      (await this.hasTakenPart(campaign.id, requesterId))
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
    await this.assertFunded(campaign);
    await this.assertWithinPlan(campaign);
    return this.prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
    });
  }

  async close(campaignId: string, requesterId: string): Promise<Campaign> {
    const campaign = await this.loadManageable(campaignId, requesterId);
    return this.closePublished(campaign, requesterId);
  }

  /** Staff override: closes any published campaign regardless of organization. */
  async closeAsAdmin(campaignId: string, adminUserId: string): Promise<Campaign> {
    const campaign = await this.requireCampaign(campaignId);
    return this.closePublished(campaign, adminUserId);
  }

  /**
   * Lets another module act when a campaign closes (payments returns its unspent
   * budget). A registration hook rather than a dependency, because payments already
   * depends on campaigns.
   */
  onClosed(listener: CampaignClosedListener): void {
    this.closedListeners.push(listener);
  }

  private async closePublished(campaign: Campaign, closedByUserId: string): Promise<Campaign> {
    if (campaign.status !== 'PUBLISHED') {
      throw new ConflictException('Only a published campaign can be closed.');
    }
    const closed = await this.prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
    // The campaign is closed either way; a follow-up that fails is logged, not surfaced.
    for (const listener of this.closedListeners) {
      try {
        await listener(closed, closedByUserId);
      } catch (error) {
        this.logger.error(`After closing campaign ${closed.id}: ${String(error)}`);
      }
    }
    return closed;
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

  /** How many submissions each campaign has, and how many still wait for the brand's review. */
  private async withSubmissionCounts(campaigns: Campaign[]): Promise<CampaignWithCounts[]> {
    if (campaigns.length === 0) {
      return [];
    }
    const groups = await this.prisma.submission.groupBy({
      by: ['campaignId', 'status'],
      where: { campaignId: { in: campaigns.map((campaign) => campaign.id) } },
      _count: { _all: true },
    });
    return campaigns.map((campaign) => {
      const own = groups.filter((group) => group.campaignId === campaign.id);
      return {
        ...campaign,
        submissionCount: own.reduce((total, group) => total + group._count._all, 0),
        pendingSubmissionCount: own
          .filter((group) => group.status === 'PENDING')
          .reduce((total, group) => total + group._count._all, 0),
      };
    });
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

  /** Creators may only join a campaign whose whole budget has been paid in. */
  private async assertFunded(campaign: Campaign): Promise<void> {
    const [funded, refunded] = await Promise.all([
      this.prisma.campaignFunding.aggregate({
        _sum: { amount: true },
        where: { campaignId: campaign.id, status: 'SUCCEEDED' },
      }),
      this.prisma.campaignRefund.aggregate({
        _sum: { amount: true },
        where: { campaignId: campaign.id, status: { in: ['PENDING', 'SUCCEEDED'] } },
      }),
    ]);
    const paid = (funded._sum.amount ?? 0) - (refunded._sum.amount ?? 0);
    if (paid < campaign.budgetAmount) {
      throw new ConflictException('Fund the campaign budget before publishing it.');
    }
  }

  private async assertWithinPlan(campaign: Campaign): Promise<void> {
    const plan = await this.entitlements.forOrganization(campaign.organizationId);
    if (campaign.visibility === 'PRIVATE' && !plan.allowsPrivateCampaigns) {
      throw new ForbiddenException(
        'Invite-only campaigns need the Growth or Scale plan. Upgrade from Subscription.',
      );
    }
    if (plan.maxActiveCampaigns !== null) {
      const live = await this.prisma.campaign.count({
        where: { organizationId: campaign.organizationId, status: 'PUBLISHED' },
      });
      if (live >= plan.maxActiveCampaigns) {
        throw new ForbiddenException(
          `Your plan allows ${plan.maxActiveCampaigns} live campaign${plan.maxActiveCampaigns === 1 ? '' : 's'} at a time. Close one or upgrade from Subscription.`,
        );
      }
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

  /**
   * A creator who applied to or submitted for a campaign keeps seeing it after it
   * closes, and after accepting an invite-only campaign's invitation: their
   * application, submission and earnings all link back to it.
   */
  private async hasTakenPart(campaignId: string, creatorUserId: string): Promise<boolean> {
    const [application, submission] = await Promise.all([
      this.prisma.application.findFirst({
        where: { campaignId, creatorUserId },
        select: { id: true },
      }),
      this.prisma.submission.findFirst({
        where: { campaignId, creatorUserId },
        select: { id: true },
      }),
    ]);
    return application !== null || submission !== null;
  }

  private isPubliclyVisible(campaign: Campaign): boolean {
    return campaign.status === 'PUBLISHED' && campaign.visibility === 'PUBLIC';
  }
}
