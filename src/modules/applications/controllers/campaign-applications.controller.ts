import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Application } from '@prisma/client';
import { CurrentUser, Principal } from '@platform/auth';
import { Permission, RequirePermission } from '@platform/rbac';
import { ApplyToCampaignDto } from '../dto/apply.dto';
import { ApplicationService } from '../services/application.service';

@ApiTags('applications')
@ApiBearerAuth()
@Controller('campaigns/:campaignId/applications')
export class CampaignApplicationsController {
  constructor(private readonly applications: ApplicationService) {}

  @RequirePermission(Permission.CampaignApply)
  @Post()
  apply(
    @CurrentUser() principal: Principal,
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Body() dto: ApplyToCampaignDto,
  ): Promise<Application> {
    return this.applications.apply(campaignId, principal.userId, dto);
  }

  @RequirePermission(Permission.CampaignManage)
  @Get()
  list(
    @CurrentUser() principal: Principal,
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
  ): Promise<Application[]> {
    return this.applications.listForCampaign(campaignId, principal.userId);
  }
}
