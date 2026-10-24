import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Principal } from '@platform/auth';
import { Permission, RequirePermission } from '@platform/rbac';
import { InvitationService, InvitationWithCampaign } from '../services/invitation.service';

@ApiTags('campaign-invitations')
@ApiBearerAuth()
@RequirePermission(Permission.CampaignApply)
@Controller('me/invitations')
export class MyInvitationsController {
  constructor(private readonly invitations: InvitationService) {}

  @Get()
  list(@CurrentUser() principal: Principal): Promise<InvitationWithCampaign[]> {
    return this.invitations.listPendingForCreator(principal.userId);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Post(':invitationId/decline')
  decline(
    @CurrentUser() principal: Principal,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
  ): Promise<void> {
    return this.invitations.decline(invitationId, principal.userId);
  }
}
