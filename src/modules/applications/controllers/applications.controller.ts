import { Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Application } from '@prisma/client';
import { CurrentUser, Principal } from '@platform/auth';
import { Permission, RequirePermission } from '@platform/rbac';
import { ApplicationService } from '../services/application.service';

@ApiTags('applications')
@ApiBearerAuth()
@Controller('applications')
export class ApplicationsController {
  constructor(private readonly applications: ApplicationService) {}

  @RequirePermission(Permission.CampaignApply)
  @HttpCode(HttpStatus.OK)
  @Post(':applicationId/withdraw')
  withdraw(
    @CurrentUser() principal: Principal,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
  ): Promise<Application> {
    return this.applications.withdraw(applicationId, principal.userId);
  }

  @RequirePermission(Permission.CampaignManage)
  @HttpCode(HttpStatus.OK)
  @Post(':applicationId/approve')
  approve(
    @CurrentUser() principal: Principal,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
  ): Promise<Application> {
    return this.applications.approve(applicationId, principal.userId);
  }

  @RequirePermission(Permission.CampaignManage)
  @HttpCode(HttpStatus.OK)
  @Post(':applicationId/decline')
  decline(
    @CurrentUser() principal: Principal,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
  ): Promise<Application> {
    return this.applications.decline(applicationId, principal.userId);
  }
}
