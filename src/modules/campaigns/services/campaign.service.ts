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
    return this.prisma.campaign.create({
      data: { ...dto, organizationId, createdByUserId: actingUserId },
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
    if (isMember || this.isPubliclyVisible(campaign)) {
      return campaign;
    }
    throw new ForbiddenException('You do not have access to this campaign.');
  }

  async update(campaignId: string, requesterId: string, dto: UpdateCampaignDto): Promise<Campaign> {
    const campaign = await this.loadManageable(campaignId, requesterId);
    this.assertDraft(campaign);
    await this.ensureCategoryExists(dto.categoryId);
    this.assertSchedule(dto.startDate ?? campaign.startDate, dto.endDate ?? campaign.endDate);
    return this.prisma.campaign.update({ where: { id: campaign.id }, data: dto });
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

  discoverPublic(): Promise<Campaign[]> {
    return this.prisma.campaign.findMany({
      where: { status: 'PUBLISHED', visibility: 'PUBLIC' },
      orderBy: { publishedAt: 'desc' },
    });
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

  private isPubliclyVisible(campaign: Campaign): boolean {
    return campaign.status === 'PUBLISHED' && campaign.visibility === 'PUBLIC';
  }
}
