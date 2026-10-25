import { Controller, Get, Header, Param, ParseUUIDPipe } from '@nestjs/common';
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

  /** The same report as a CSV download. */
  @RequirePermission(Permission.CampaignManage)
  @Get('csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="campaign-report.csv"')
  csv(
    @CurrentUser() principal: Principal,
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
  ): Promise<string> {
    return this.analytics.campaignReportCsv(campaignId, principal.userId);
  }
}
