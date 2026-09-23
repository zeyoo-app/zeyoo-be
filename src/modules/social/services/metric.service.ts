import { Injectable } from '@nestjs/common';
import { MetricSnapshot } from '@prisma/client';
import { PrismaService } from '@platform/database/prisma.service';
import { CampaignService } from '@modules/campaigns/campaigns.public';
import { OrganizationService } from '@modules/iam/iam.public';
import { IngestMetricsDto } from '../dto/ingest-metrics.dto';

@Injectable()
export class MetricService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly campaigns: CampaignService,
    private readonly organizations: OrganizationService,
  ) {}

  // Stands in for the scheduled social-platform poller: records one metric
  // snapshot for a creator on a campaign. Restricted to the campaign's org.
  async ingest(
    campaignId: string,
    requesterId: string,
    dto: IngestMetricsDto,
  ): Promise<MetricSnapshot> {
    const campaign = await this.campaigns.requireCampaign(campaignId);
    await this.organizations.assertMember(campaign.organizationId, requesterId);
    return this.prisma.metricSnapshot.create({ data: { campaignId, ...dto } });
  }

  async listForCampaign(campaignId: string, requesterId: string): Promise<MetricSnapshot[]> {
    const campaign = await this.campaigns.requireCampaign(campaignId);
    await this.organizations.assertMember(campaign.organizationId, requesterId);
    return this.prisma.metricSnapshot.findMany({
      where: { campaignId },
      orderBy: { capturedAt: 'desc' },
    });
  }

  totalViewsForCampaign(campaignId: string): Promise<number> {
    return this.prisma.metricSnapshot
      .aggregate({ _sum: { views: true }, where: { campaignId } })
      .then((result) => result._sum.views ?? 0);
  }
}
