import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { FraudCase, FraudCaseStatus, RiskLevel } from '@prisma/client';
import { PrismaService } from '@platform/database/prisma.service';
import { CampaignService } from '@modules/campaigns/campaigns.public';
import { OrganizationService } from '@modules/iam/iam.public';
import { AssessEngagementDto, FlagFraudDto } from '../dto/fraud.dto';
import { assessEngagement } from '../domain/risk-rules';

@Injectable()
export class FraudService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly campaigns: CampaignService,
    private readonly organizations: OrganizationService,
  ) {}

  async assess(
    campaignId: string,
    requesterId: string,
    dto: AssessEngagementDto,
  ): Promise<{ level: RiskLevel }> {
    await this.assertCampaignMember(campaignId, requesterId);
    return { level: assessEngagement(dto) };
  }

  async flag(campaignId: string, requesterId: string, dto: FlagFraudDto): Promise<FraudCase> {
    await this.assertCampaignMember(campaignId, requesterId);
    return this.prisma.fraudCase.create({
      data: {
        campaignId,
        creatorUserId: dto.creatorUserId,
        level: dto.level,
        note: dto.note ?? null,
        createdByUserId: requesterId,
      },
    });
  }

  async listForCampaign(campaignId: string, requesterId: string): Promise<FraudCase[]> {
    await this.assertCampaignMember(campaignId, requesterId);
    return this.prisma.fraudCase.findMany({
      where: { campaignId },
      orderBy: { createdAt: 'desc' },
    });
  }

  resolve(caseId: string, requesterId: string): Promise<FraudCase> {
    return this.close(caseId, requesterId, 'RESOLVED');
  }

  dismiss(caseId: string, requesterId: string): Promise<FraudCase> {
    return this.close(caseId, requesterId, 'DISMISSED');
  }

  private async close(
    caseId: string,
    requesterId: string,
    status: Extract<FraudCaseStatus, 'RESOLVED' | 'DISMISSED'>,
  ): Promise<FraudCase> {
    const fraudCase = await this.prisma.fraudCase.findUnique({ where: { id: caseId } });
    if (!fraudCase) {
      throw new NotFoundException('Fraud case not found.');
    }
    await this.assertCampaignMember(fraudCase.campaignId, requesterId);
    if (fraudCase.status !== 'OPEN') {
      throw new ConflictException('Only an open case can be closed.');
    }
    return this.prisma.fraudCase.update({
      where: { id: fraudCase.id },
      data: { status, resolvedByUserId: requesterId, resolvedAt: new Date() },
    });
  }

  private async assertCampaignMember(campaignId: string, requesterId: string): Promise<void> {
    const campaign = await this.campaigns.requireCampaign(campaignId);
    await this.organizations.assertMember(campaign.organizationId, requesterId);
  }
}
