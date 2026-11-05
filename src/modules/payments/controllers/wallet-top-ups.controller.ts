import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Principal } from '@platform/auth';
import { Permission, RequirePermission } from '@platform/rbac';
import { TopUpCreated, TopUpService } from '../application/top-up.service';
import { WalletTopUpDto } from '../dto/payments.dto';

@ApiTags('wallet')
@ApiBearerAuth()
@Controller('organizations/:organizationId/wallet/top-ups')
export class WalletTopUpsController {
  constructor(private readonly topUps: TopUpService) {}

  // Opens Stripe Checkout to add money to the brand's wallet.
  @RequirePermission(Permission.CampaignManage)
  @Post()
  create(
    @CurrentUser() principal: Principal,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: WalletTopUpDto,
  ): Promise<TopUpCreated> {
    return this.topUps.create(organizationId, principal.userId, dto.amountMinor, dto.client);
  }
}
