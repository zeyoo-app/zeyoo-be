import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FraudCase, FraudCaseStatus, RiskLevel } from '@prisma/client';
import { PrismaService } from '@platform/database/prisma.service';
import { CampaignService } from '@modules/campaigns/campaigns.public';
import { CreatorProfileService } from '@modules/creators/creators.public';
import { OrganizationService } from '@modules/iam/iam.public';
import { NotificationService } from '@modules/notifications/notifications.public';
import { SubmissionService } from '@modules/submissions/submissions.public';
import { AssessEngagementDto, FlagFraudDto } from '../dto/fraud.dto';
import { assessEngagement } from '../domain/risk-rules';

export type ClosingStatus = Extract<FraudCaseStatus, 'RESOLVED' | 'DISMISSED'>;

/** Cases in these states stop the creator's earnings on the campaign. */
const BLOCKING_STATUSES: FraudCaseStatus[] = ['OPEN', 'RESOLVED'];

export interface FraudCaseView extends FraudCase {
  campaignTitle: string;
  creatorName: string;
}

@Injectable()
export class FraudService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly campaigns: CampaignService,
    private readonly organizations: OrganizationService,
    private readonly profiles: CreatorProfileService,
    private readonly notifications: NotificationService,
    private readonly submissions: SubmissionService,
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
    const campaign = await this.assertCampaignMember(campaignId, requesterId);
    const submitted = await this.submissions.campaignIdsForCreator(dto.creatorUserId);
    if (!submitted.includes(campaignId)) {
      throw new NotFoundException('This creator has not submitted to the campaign.');
    }
    await this.assertNoOpenCase(campaignId, dto.creatorUserId);
    const fraudCase = await this.prisma.fraudCase.create({
      data: {
        campaignId,
        creatorUserId: dto.creatorUserId,
        level: dto.level,
        note: dto.note ?? null,
        createdByUserId: requesterId,
      },
    });
    await this.notifications.notify({
      userId: dto.creatorUserId,
      type: 'FRAUD_FLAGGED',
      title: 'Earnings paused on a campaign',
      body: `"${campaign.title}" is under review. New earnings are paused until it is cleared. You can dispute this from your submissions.`,
    });
    return fraudCase;
  }

  async listForCampaign(campaignId: string, requesterId: string): Promise<FraudCaseView[]> {
    await this.assertCampaignMember(campaignId, requesterId);
    const cases = await this.prisma.fraudCase.findMany({
      where: { campaignId },
      orderBy: { createdAt: 'desc' },
    });
    return this.withContext(cases);
  }

  async listForAdmin(status?: FraudCaseStatus): Promise<FraudCaseView[]> {
    const cases = await this.prisma.fraudCase.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
    });
    return this.withContext(cases);
  }

  async findView(caseId: string): Promise<FraudCaseView | null> {
    const fraudCase = await this.prisma.fraudCase.findUnique({ where: { id: caseId } });
    return fraudCase ? (await this.withContext([fraudCase]))[0] : null;
  }

  async listForCreator(creatorUserId: string): Promise<FraudCaseView[]> {
    const cases = await this.prisma.fraudCase.findMany({
      where: { creatorUserId },
      orderBy: { createdAt: 'desc' },
    });
    return this.withContext(cases);
  }

  async pausedCreatorIds(campaignId: string): Promise<Set<string>> {
    const cases = await this.prisma.fraudCase.findMany({
      where: { campaignId, status: { in: BLOCKING_STATUSES } },
      select: { creatorUserId: true },
    });
    return new Set(cases.map((fraudCase) => fraudCase.creatorUserId));
  }

  async pausedCampaignIds(creatorUserId: string): Promise<Set<string>> {
    const cases = await this.prisma.fraudCase.findMany({
      where: { creatorUserId, status: { in: BLOCKING_STATUSES } },
      select: { campaignId: true },
    });
    return new Set(cases.map((fraudCase) => fraudCase.campaignId));
  }

  async assertCreatorOf(caseId: string, creatorUserId: string): Promise<FraudCase> {
    const fraudCase = await this.requireCase(caseId);
    if (fraudCase.creatorUserId !== creatorUserId) {
      throw new ForbiddenException('This case is not about you.');
    }
    return fraudCase;
  }

  async closeAsBrand(
    caseId: string,
    requesterId: string,
    status: ClosingStatus,
  ): Promise<FraudCase> {
    const fraudCase = await this.requireCase(caseId);
    await this.assertCampaignMember(fraudCase.campaignId, requesterId);
    return this.close(fraudCase, requesterId, status);
  }

  async closeAsAdmin(caseId: string, adminId: string, status: ClosingStatus): Promise<FraudCase> {
    return this.close(await this.requireCase(caseId), adminId, status);
  }

  private async close(
    fraudCase: FraudCase,
    closedByUserId: string,
    status: ClosingStatus,
  ): Promise<FraudCase> {
    if (fraudCase.status !== 'OPEN') {
      throw new ConflictException('Only an open case can be closed.');
    }
    const closed = await this.prisma.fraudCase.update({
      where: { id: fraudCase.id },
      data: { status, resolvedByUserId: closedByUserId, resolvedAt: new Date() },
    });
    await this.notifyOutcome(closed);
    return closed;
  }

  private async notifyOutcome(fraudCase: FraudCase): Promise<void> {
    const campaign = await this.campaigns.requireCampaign(fraudCase.campaignId);
    const cleared = fraudCase.status === 'DISMISSED';
    await this.notifications.notify({
      userId: fraudCase.creatorUserId,
      type: cleared ? 'FRAUD_CLEARED' : 'FRAUD_CONFIRMED',
      title: cleared ? 'Earnings resumed' : 'Review concluded',
      body: cleared
        ? `The review on "${campaign.title}" is cleared and your earnings continue.`
        : `The review on "${campaign.title}" confirmed a problem. No further earnings will be added to that campaign.`,
    });
  }

  private async assertNoOpenCase(campaignId: string, creatorUserId: string): Promise<void> {
    const existing = await this.prisma.fraudCase.findFirst({
      where: { campaignId, creatorUserId, status: 'OPEN' },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('This creator already has an open case on this campaign.');
    }
  }

  private async withContext(cases: FraudCase[]): Promise<FraudCaseView[]> {
    const campaignIds = [...new Set(cases.map((fraudCase) => fraudCase.campaignId))];
    const [campaigns, creators] = await Promise.all([
      this.campaigns.findManyByIds(campaignIds),
      this.profiles.summariesByUserIds(cases.map((fraudCase) => fraudCase.creatorUserId)),
    ]);
    const titles = new Map(campaigns.map((campaign) => [campaign.id, campaign.title]));
    return cases.map((fraudCase) => ({
      ...fraudCase,
      campaignTitle: titles.get(fraudCase.campaignId) ?? 'Campaign',
      creatorName: creators.get(fraudCase.creatorUserId)?.displayName ?? 'Creator',
    }));
  }

  private async requireCase(caseId: string): Promise<FraudCase> {
    const fraudCase = await this.prisma.fraudCase.findUnique({ where: { id: caseId } });
    if (!fraudCase) {
      throw new NotFoundException('Fraud case not found.');
    }
    return fraudCase;
  }

  private async assertCampaignMember(campaignId: string, requesterId: string) {
    const campaign = await this.campaigns.requireCampaign(campaignId);
    await this.organizations.assertMember(campaign.organizationId, requesterId);
    return campaign;
  }
}
