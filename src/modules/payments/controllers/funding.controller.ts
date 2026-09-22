import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Principal } from '@platform/auth';
import { Permission, RequirePermission } from '@platform/rbac';
import { FundingCreated, FundingService } from '../application/funding.service';
import { CreateFundingDto } from '../dto/payments.dto';

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
    return this.funding.createForCampaign(campaignId, principal.userId, dto.amountMinor);
  }
}
