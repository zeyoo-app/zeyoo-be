import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Withdrawal } from '@prisma/client';
import { CurrentUser, Principal } from '@platform/auth';
import { Permission, RequirePermission } from '@platform/rbac';
import { WithdrawalService } from '../application/withdrawal.service';
import { RequestWithdrawalDto } from '../dto/payments.dto';

@ApiTags('withdrawals')
@ApiBearerAuth()
@RequirePermission(Permission.WithdrawalRequest)
@Controller('me/withdrawals')
export class WithdrawalsController {
  constructor(private readonly withdrawals: WithdrawalService) {}

  @Post()
  request(
    @CurrentUser() principal: Principal,
    @Body() dto: RequestWithdrawalDto,
  ): Promise<Withdrawal> {
    return this.withdrawals.request(principal.userId, dto.amountMinor, dto.currencyCode);
  }

  @Get()
  list(@CurrentUser() principal: Principal): Promise<Withdrawal[]> {
    return this.withdrawals.listOwn(principal.userId);
  }
}
