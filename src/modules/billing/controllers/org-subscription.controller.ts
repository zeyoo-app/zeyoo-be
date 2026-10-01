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
import { SubscribeDto } from '../dto/subscribe.dto';
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
  ): Promise<{ url: string }> {
    return this.billing.startCardSetup(organizationId, principal.userId);
  }

  @RequirePermission(Permission.OrgManage)
  @HttpCode(HttpStatus.OK)
  @Post('subscription/checkout')
  checkout(
    @CurrentUser() principal: Principal,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: SubscribeDto,
  ): Promise<{ url: string }> {
    return this.billing.startCheckout(organizationId, principal.userId, dto.planKey);
  }
}
