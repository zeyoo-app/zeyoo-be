import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Withdrawal } from '@prisma/client';
import { CurrentUser, Principal } from '@platform/auth';
import { Permission, RequirePermission } from '@platform/rbac';
import { WithdrawalService } from '../application/withdrawal.service';
import { HoldWithdrawalDto } from '../dto/payments.dto';

@ApiTags('admin-payouts')
@ApiBearerAuth()
@RequirePermission(Permission.AdminAccess)
@Controller('admin/withdrawals')
export class AdminPayoutsController {
  constructor(private readonly withdrawals: WithdrawalService) {}

  @Get()
  listOpen(): Promise<Withdrawal[]> {
    return this.withdrawals.listOpen();
  }

  @HttpCode(HttpStatus.OK)
  @Post(':withdrawalId/hold')
  hold(
    @Param('withdrawalId', ParseUUIDPipe) withdrawalId: string,
    @Body() dto: HoldWithdrawalDto,
  ): Promise<Withdrawal> {
    return this.withdrawals.hold(withdrawalId, dto.reason);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':withdrawalId/release')
  release(@Param('withdrawalId', ParseUUIDPipe) withdrawalId: string): Promise<Withdrawal> {
    return this.withdrawals.release(withdrawalId);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':withdrawalId/reject')
  reject(
    @CurrentUser() principal: Principal,
    @Param('withdrawalId', ParseUUIDPipe) withdrawalId: string,
  ): Promise<Withdrawal> {
    return this.withdrawals.reject(withdrawalId, principal.userId);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':withdrawalId/approve')
  approve(
    @CurrentUser() principal: Principal,
    @Param('withdrawalId', ParseUUIDPipe) withdrawalId: string,
  ): Promise<Withdrawal> {
    return this.withdrawals.approve(withdrawalId, principal.userId);
  }
}
