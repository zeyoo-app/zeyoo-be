import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Principal } from '@platform/auth';
import { Permission, RequirePermission } from '@platform/rbac';
import { AnalyticsService, OrganizationPerformance } from '../services/analytics.service';

@ApiTags('analytics')
@ApiBearerAuth()
@Controller('organizations/:organizationId/performance')
export class OrganizationPerformanceController {
  constructor(private readonly analytics: AnalyticsService) {}

  /** Views and creator payouts for every launched campaign, with brand-wide totals. */
  @RequirePermission(Permission.CampaignManage)
  @Get()
  get(
    @CurrentUser() principal: Principal,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
  ): Promise<OrganizationPerformance> {
    return this.analytics.organizationPerformance(organizationId, principal.userId);
  }
}
