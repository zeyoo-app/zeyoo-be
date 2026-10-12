import { Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Principal } from '@platform/auth';
import { Permission, RequirePermission } from '@platform/rbac';
import {
  CampaignEarnings,
  CreatorCampaignEarnings,
  EarningsSettlementService,
  SettlementSummary,
} from '../application/earnings-settlement.service';

@ApiTags('earnings')
@ApiBearerAuth()
@Controller()
export class EarningsController {
  constructor(private readonly settlement: EarningsSettlementService) {}

  @RequirePermission(Permission.ContentSubmit)
  @Get('me/campaign-earnings')
  mine(@CurrentUser() principal: Principal): Promise<CreatorCampaignEarnings[]> {
    return this.settlement.getCreatorEarnings(principal.userId);
  }

  @RequirePermission(Permission.CampaignManage)
  @Get('campaigns/:campaignId/earnings')
  summary(
    @CurrentUser() principal: Principal,
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
  ): Promise<CampaignEarnings> {
    return this.settlement.getCampaignEarnings(campaignId, principal.userId);
  }

  @RequirePermission(Permission.CampaignManage)
  @Post('campaigns/:campaignId/earnings/settle')
  settle(
    @CurrentUser() principal: Principal,
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
  ): Promise<SettlementSummary> {
    return this.settlement.settleCampaign(campaignId, principal.userId);
  }
}
