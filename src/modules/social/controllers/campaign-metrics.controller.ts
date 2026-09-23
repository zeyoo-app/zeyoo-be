import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { MetricSnapshot } from '@prisma/client';
import { CurrentUser, Principal } from '@platform/auth';
import { Permission, RequirePermission } from '@platform/rbac';
import { IngestMetricsDto } from '../dto/ingest-metrics.dto';
import { MetricService } from '../services/metric.service';

@ApiTags('metrics')
@ApiBearerAuth()
@Controller('campaigns/:campaignId/metrics')
export class CampaignMetricsController {
  constructor(private readonly metrics: MetricService) {}

  @RequirePermission(Permission.CampaignManage)
  @Post()
  ingest(
    @CurrentUser() principal: Principal,
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Body() dto: IngestMetricsDto,
  ): Promise<MetricSnapshot> {
    return this.metrics.ingest(campaignId, principal.userId, dto);
  }

  @Get()
  list(
    @CurrentUser() principal: Principal,
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
  ): Promise<MetricSnapshot[]> {
    return this.metrics.listForCampaign(campaignId, principal.userId);
  }
}
