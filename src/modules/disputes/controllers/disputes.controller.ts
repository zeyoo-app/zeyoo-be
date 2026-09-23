import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Dispute, DisputeEvent } from '@prisma/client';
import { CurrentUser, Principal } from '@platform/auth';
import { Permission } from '@platform/rbac';
import { DisputeMessageDto, OpenDisputeDto } from '../dto/dispute.dto';
import { DisputeService, DisputeWithEvents } from '../services/dispute.service';

function isAdmin(principal: Principal): boolean {
  return principal.permissions.includes(Permission.AdminAccess);
}

@ApiTags('disputes')
@ApiBearerAuth()
@Controller('disputes')
export class DisputesController {
  constructor(private readonly disputes: DisputeService) {}

  @Post()
  open(@CurrentUser() principal: Principal, @Body() dto: OpenDisputeDto): Promise<Dispute> {
    return this.disputes.open(principal.userId, dto);
  }

  @Get()
  listOwn(@CurrentUser() principal: Principal): Promise<Dispute[]> {
    return this.disputes.listOwn(principal.userId);
  }

  @Get(':disputeId')
  get(
    @CurrentUser() principal: Principal,
    @Param('disputeId', ParseUUIDPipe) disputeId: string,
  ): Promise<DisputeWithEvents> {
    return this.disputes.get(disputeId, principal.userId, isAdmin(principal));
  }

  @Post(':disputeId/messages')
  addMessage(
    @CurrentUser() principal: Principal,
    @Param('disputeId', ParseUUIDPipe) disputeId: string,
    @Body() dto: DisputeMessageDto,
  ): Promise<DisputeEvent> {
    return this.disputes.addMessage(disputeId, principal.userId, isAdmin(principal), dto);
  }
}
