import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Principal } from '@platform/auth';
import { Permission, RequirePermission } from '@platform/rbac';
import {
  CreatorLedgerEntryView,
  OrganizationLedgerEntryView,
  WalletService,
  WalletView,
} from '../application/wallet.service';

@ApiTags('wallet')
@ApiBearerAuth()
@Controller()
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @RequirePermission(Permission.WithdrawalRequest)
  @Get('me/wallet')
  getWallet(@CurrentUser() principal: Principal): Promise<WalletView> {
    return this.wallet.getWallet(principal.userId);
  }

  @RequirePermission(Permission.WithdrawalRequest)
  @Get('me/ledger')
  getLedger(@CurrentUser() principal: Principal): Promise<CreatorLedgerEntryView[]> {
    return this.wallet.getCreatorLedger(principal.userId);
  }

  // Returns the hosted Stripe Connect onboarding URL for the client to open.
  @RequirePermission(Permission.WithdrawalRequest)
  @HttpCode(HttpStatus.OK)
  @Post('me/payout/connect')
  connectPayout(@CurrentUser() principal: Principal): Promise<{ url: string }> {
    return this.wallet.connectPayout(principal.userId);
  }

  @Get('organizations/:organizationId/ledger')
  getOrganizationLedger(
    @CurrentUser() principal: Principal,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
  ): Promise<OrganizationLedgerEntryView[]> {
    return this.wallet.getOrganizationLedger(organizationId, principal.userId);
  }
}
