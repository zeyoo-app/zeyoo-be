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
import { Subscription } from '@prisma/client';
import { CurrentUser, Principal } from '@platform/auth';
import { Permission, RequirePermission } from '@platform/rbac';
import { HostedFlowDto, SubscribeDto } from '../dto/subscribe.dto';
import { BillingService, BrandBillingView } from '../services/billing.service';

@ApiTags('billing')
@ApiBearerAuth()
@Controller('organizations/:organizationId')
export class OrgSubscriptionController {
  constructor(private readonly billing: BillingService) {}

  @Get('subscription')
  get(
    @CurrentUser() principal: Principal,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
  ): Promise<Subscription | null> {
    return this.billing.getSubscription(organizationId, principal.userId);
  }

  @Get('billing')
  getBilling(
    @CurrentUser() principal: Principal,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
  ): Promise<BrandBillingView> {
    return this.billing.getBilling(organizationId, principal.userId);
  }

  @RequirePermission(Permission.OrgManage)
  @HttpCode(HttpStatus.OK)
  @Post('payment-methods')
  addPaymentMethod(
    @CurrentUser() principal: Principal,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: HostedFlowDto,
  ): Promise<{ url: string }> {
    return this.billing.startCardSetup(organizationId, principal.userId, dto.client);
  }

  @RequirePermission(Permission.OrgManage)
  @HttpCode(HttpStatus.OK)
  @Post('subscription/checkout')
  checkout(
    @CurrentUser() principal: Principal,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: SubscribeDto,
  ): Promise<{ url: string | null; changed?: boolean }> {
    return this.billing.startCheckout(organizationId, principal.userId, dto.planKey, dto.client);
  }

  // Ends the paid plan at the end of the period already paid for (back to Starter).
  @RequirePermission(Permission.OrgManage)
  @HttpCode(HttpStatus.OK)
  @Post('subscription/cancel')
  cancel(
    @CurrentUser() principal: Principal,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
  ): Promise<{ planEndsAt: string }> {
    return this.billing.cancel(organizationId, principal.userId);
  }

  // Keeps a plan that was set to end.
  @RequirePermission(Permission.OrgManage)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('subscription/resume')
  resume(
    @CurrentUser() principal: Principal,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
  ): Promise<void> {
    return this.billing.resume(organizationId, principal.userId);
  }
}
