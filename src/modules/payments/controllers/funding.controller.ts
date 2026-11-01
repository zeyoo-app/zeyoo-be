import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Principal } from '@platform/auth';
import { Permission, RequirePermission } from '@platform/rbac';
import { FundingCreated, FundingService, FundingStatus } from '../application/funding.service';
import { CreateFundingDto, WalletFundingDto } from '../dto/payments.dto';

@ApiTags('funding')
@ApiBearerAuth()
@Controller('campaigns/:campaignId/funding')
export class FundingController {
  constructor(private readonly funding: FundingService) {}

  @RequirePermission(Permission.CampaignManage)
  @Post()
  create(
    @CurrentUser() principal: Principal,
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Body() dto: CreateFundingDto,
  ): Promise<FundingCreated> {
    return this.funding.createForCampaign(
      campaignId,
      principal.userId,
      dto.amountMinor,
      dto.client,
    );
  }

  // Pays the budget and plan fee from the brand's wallet; settles immediately.
  @RequirePermission(Permission.CampaignManage)
  @Post('wallet')
  fromWallet(
    @CurrentUser() principal: Principal,
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Body() dto: WalletFundingDto,
  ): Promise<FundingCreated> {
    return this.funding.fundFromWallet(campaignId, principal.userId, dto.amountMinor);
  }

  @RequirePermission(Permission.CampaignManage)
  @Get()
  latest(
    @CurrentUser() principal: Principal,
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
  ): Promise<FundingStatus | null> {
    return this.funding.latestForCampaign(campaignId, principal.userId);
  }
}
