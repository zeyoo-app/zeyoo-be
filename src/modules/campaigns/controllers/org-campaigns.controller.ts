import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Campaign } from '@prisma/client';
import { CurrentUser, Principal } from '@platform/auth';
import { Permission, RequirePermission } from '@platform/rbac';
import { CreateCampaignDto } from '../dto/campaign.dto';
import { CampaignService } from '../services/campaign.service';

@ApiTags('campaigns')
@ApiBearerAuth()
@Controller('organizations/:organizationId/campaigns')
export class OrgCampaignsController {
  constructor(private readonly campaigns: CampaignService) {}

  @RequirePermission(Permission.CampaignManage)
  @Post()
  create(
    @CurrentUser() principal: Principal,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: CreateCampaignDto,
  ): Promise<Campaign> {
    return this.campaigns.create(organizationId, principal.userId, dto);
  }

  @Get()
  list(
    @CurrentUser() principal: Principal,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
  ): Promise<Campaign[]> {
    return this.campaigns.listForOrganization(organizationId, principal.userId);
  }
}
