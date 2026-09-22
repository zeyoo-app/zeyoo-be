import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Campaign } from '@prisma/client';
import { CurrentUser, Principal } from '@platform/auth';
import { Permission, RequirePermission } from '@platform/rbac';
import { UpdateCampaignDto } from '../dto/campaign.dto';
import { CampaignService } from '../services/campaign.service';

@ApiTags('campaigns')
@ApiBearerAuth()
@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly campaigns: CampaignService) {}

  @Get('discover')
  discover(): Promise<Campaign[]> {
    return this.campaigns.discoverPublic();
  }

  @Get(':campaignId')
  get(
    @CurrentUser() principal: Principal,
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
  ): Promise<Campaign> {
    return this.campaigns.getById(campaignId, principal.userId);
  }

  @RequirePermission(Permission.CampaignManage)
  @Patch(':campaignId')
  update(
    @CurrentUser() principal: Principal,
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Body() dto: UpdateCampaignDto,
  ): Promise<Campaign> {
    return this.campaigns.update(campaignId, principal.userId, dto);
  }

  @RequirePermission(Permission.CampaignManage)
  @HttpCode(HttpStatus.OK)
  @Post(':campaignId/publish')
  publish(
    @CurrentUser() principal: Principal,
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
  ): Promise<Campaign> {
    return this.campaigns.publish(campaignId, principal.userId);
  }

  @RequirePermission(Permission.CampaignManage)
  @HttpCode(HttpStatus.OK)
  @Post(':campaignId/close')
  close(
    @CurrentUser() principal: Principal,
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
  ): Promise<Campaign> {
    return this.campaigns.close(campaignId, principal.userId);
  }
}
