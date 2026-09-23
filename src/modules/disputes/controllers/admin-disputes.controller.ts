import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Dispute } from '@prisma/client';
import { Permission, RequirePermission } from '@platform/rbac';
import { DisputeService } from '../services/dispute.service';

@ApiTags('disputes')
@ApiBearerAuth()
@RequirePermission(Permission.AdminAccess)
@Controller('admin/disputes')
export class AdminDisputesController {
  constructor(private readonly disputes: DisputeService) {}

  @Get()
  listOpen(): Promise<Dispute[]> {
    return this.disputes.listOpen();
  }

  @HttpCode(HttpStatus.OK)
  @Post(':disputeId/review')
  review(@Param('disputeId', ParseUUIDPipe) disputeId: string): Promise<Dispute> {
    return this.disputes.review(disputeId);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':disputeId/resolve')
  resolve(@Param('disputeId', ParseUUIDPipe) disputeId: string): Promise<Dispute> {
    return this.disputes.resolve(disputeId);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':disputeId/reject')
  reject(@Param('disputeId', ParseUUIDPipe) disputeId: string): Promise<Dispute> {
    return this.disputes.reject(disputeId);
  }
}
