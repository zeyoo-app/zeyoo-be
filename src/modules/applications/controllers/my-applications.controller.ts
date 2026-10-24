import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Principal } from '@platform/auth';
import { Permission, RequirePermission } from '@platform/rbac';
import { ApplicationService, ApplicationWithCampaign } from '../services/application.service';

@ApiTags('applications')
@ApiBearerAuth()
@RequirePermission(Permission.CampaignApply)
@Controller('me/applications')
export class MyApplicationsController {
  constructor(private readonly applications: ApplicationService) {}

  @Get()
  list(@CurrentUser() principal: Principal): Promise<ApplicationWithCampaign[]> {
    return this.applications.listOwn(principal.userId);
  }
}
