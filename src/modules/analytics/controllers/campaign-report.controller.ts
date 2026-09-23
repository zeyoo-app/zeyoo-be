import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Principal } from '@platform/auth';
import { Permission, RequirePermission } from '@platform/rbac';
import { AnalyticsService, CampaignReport } from '../services/analytics.service';

@ApiTags('analytics')
@ApiBearerAuth()
@Controller('campaigns/:campaignId/report')
export class CampaignReportController {
  constructor(private readonly analytics: AnalyticsService) {}

  @RequirePermission(Permission.CampaignManage)
  @Get()
  get(
    @CurrentUser() principal: Principal,
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
  ): Promise<CampaignReport> {
    return this.analytics.campaignReport(campaignId, principal.userId);
  }
}
