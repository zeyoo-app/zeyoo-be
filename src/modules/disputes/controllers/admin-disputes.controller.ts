import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Principal } from '@platform/auth';
import { Permission, RequirePermission } from '@platform/rbac';
import { DisputeDecisionDto } from '../dto/dispute.dto';
import { DisputeService, DisputeView } from '../services/dispute.service';

@ApiTags('admin')
@ApiBearerAuth()
@RequirePermission(Permission.AdminAccess)
@Controller('admin/disputes')
export class AdminDisputesController {
  constructor(private readonly disputes: DisputeService) {}

  @Get()
  list(
    @CurrentUser() principal: Principal,
    @Query('scope') scope?: string,
  ): Promise<DisputeView[]> {
    return this.disputes.listForAdmin(scope === 'closed' ? 'closed' : 'active', principal.userId);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':disputeId/review')
  review(
    @CurrentUser() principal: Principal,
    @Param('disputeId', ParseUUIDPipe) disputeId: string,
  ): Promise<DisputeView> {
    return this.disputes.markUnderReview(disputeId, principal.userId);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':disputeId/decision')
  decide(
    @CurrentUser() principal: Principal,
    @Param('disputeId', ParseUUIDPipe) disputeId: string,
    @Body() dto: DisputeDecisionDto,
  ): Promise<DisputeView> {
    return this.disputes.decide(disputeId, principal.userId, dto);
  }
}
