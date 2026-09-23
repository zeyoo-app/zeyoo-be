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
import { BillingService } from '../services/billing.service';

@ApiTags('billing')
@ApiBearerAuth()
@Controller('organizations/:organizationId/subscription')
export class OrgSubscriptionController {
  constructor(private readonly billing: BillingService) {}

  @Get()
  get(
    @CurrentUser() principal: Principal,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
  ): Promise<Subscription | null> {
    return this.billing.getSubscription(organizationId, principal.userId);
  }

  @RequirePermission(Permission.OrgManage)
  @HttpCode(HttpStatus.OK)
  @Post('checkout')
  checkout(
    @CurrentUser() principal: Principal,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: SubscribeDto,
  ): Promise<{ url: string }> {
    return this.billing.startCheckout(organizationId, principal.userId, dto.planKey);
  }
}
