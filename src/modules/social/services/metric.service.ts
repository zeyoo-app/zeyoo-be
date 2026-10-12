import { Injectable } from '@nestjs/common';
import { MetricSnapshot, MetricSource, SocialPlatform } from '@prisma/client';
import { UnifiedPostMetrics } from '../domain/unified-metrics';
import { PrismaService } from '@platform/database/prisma.service';
import { CampaignService } from '@modules/campaigns/campaigns.public';
import { OrganizationService } from '@modules/iam/iam.public';
import { IngestMetricsDto } from '../dto/ingest-metrics.dto';

export interface EngagementReading {
  views: number;
  likes: number;
  comments: number;
  shares: number;
}

export interface SnapshotReading {
  campaignId: string;
  creatorUserId: string;
  submissionId: string;
  platform: SocialPlatform;
  source: MetricSource;
  metrics: UnifiedPostMetrics;
}

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

  // Records one reading of a submission's post. Counts a platform does not report
  // are stored as 0, matching the snapshot columns.
  recordSnapshot(reading: SnapshotReading): Promise<MetricSnapshot> {
    const { metrics } = reading;
    return this.prisma.metricSnapshot.create({
      data: {
        campaignId: reading.campaignId,
        creatorUserId: reading.creatorUserId,
        submissionId: reading.submissionId,
        platform: reading.platform,
        source: reading.source,
        views: metrics.views,
        likes: metrics.likes ?? 0,
        comments: metrics.comments ?? 0,
        shares: metrics.shares ?? 0,
        capturedAt: metrics.capturedAt,
      },
    });
  }

  async listForCampaign(campaignId: string, requesterId: string): Promise<MetricSnapshot[]> {
    const campaign = await this.campaigns.requireCampaign(campaignId);
    await this.organizations.assertMember(campaign.organizationId, requesterId);
    return this.prisma.metricSnapshot.findMany({
      where: { campaignId },
      orderBy: { capturedAt: 'desc' },
    });
  }

  // Snapshots are cumulative readings over time, so only each creator's most
  // recent reading per platform counts; summing every snapshot would double-count.
  async latestViewsByCreator(campaignId: string): Promise<Map<string, number>> {
    const latestPerPlatform = await this.prisma.metricSnapshot.findMany({
      where: { campaignId },
      orderBy: { capturedAt: 'desc' },
      distinct: ['creatorUserId', 'platform'],
      select: { creatorUserId: true, views: true },
    });
    const viewsByCreator = new Map<string, number>();
    for (const { creatorUserId, views } of latestPerPlatform) {
      viewsByCreator.set(creatorUserId, (viewsByCreator.get(creatorUserId) ?? 0) + views);
    }
    return viewsByCreator;
  }

  // Every engagement count from each creator's most recent readings, for risk checks.
  async latestReadingsByCreator(campaignId: string): Promise<Map<string, EngagementReading>> {
    const latestPerPlatform = await this.prisma.metricSnapshot.findMany({
      where: { campaignId },
      orderBy: { capturedAt: 'desc' },
      distinct: ['creatorUserId', 'platform'],
    });
    const readings = new Map<string, EngagementReading>();
    for (const snapshot of latestPerPlatform) {
      const current = readings.get(snapshot.creatorUserId) ?? {
        views: 0,
        likes: 0,
        comments: 0,
        shares: 0,
      };
      readings.set(snapshot.creatorUserId, {
        views: current.views + snapshot.views,
        likes: current.likes + snapshot.likes,
        comments: current.comments + snapshot.comments,
        shares: current.shares + snapshot.shares,
      });
    }
    return readings;
  }

  // Each campaign's most recent reading per platform, summed for one creator.
  async latestViewsByCampaignForCreator(creatorUserId: string): Promise<Map<string, number>> {
    const latestPerPlatform = await this.prisma.metricSnapshot.findMany({
      where: { creatorUserId },
      orderBy: { capturedAt: 'desc' },
      distinct: ['campaignId', 'platform'],
      select: { campaignId: true, views: true },
    });
    const viewsByCampaign = new Map<string, number>();
    for (const { campaignId, views } of latestPerPlatform) {
      viewsByCampaign.set(campaignId, (viewsByCampaign.get(campaignId) ?? 0) + views);
    }
    return viewsByCampaign;
  }

  async totalViewsForCampaign(campaignId: string): Promise<number> {
    const viewsByCreator = await this.latestViewsByCreator(campaignId);
    return [...viewsByCreator.values()].reduce((total, views) => total + views, 0);
  }
}
