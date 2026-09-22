import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CampaignInvitation } from '@prisma/client';
import { CurrentUser, Principal } from '@platform/auth';
import { Permission, RequirePermission } from '@platform/rbac';
import { InviteCreatorDto } from '../dto/invitation.dto';
import { InvitationService } from '../services/invitation.service';

@ApiTags('campaign-invitations')
@ApiBearerAuth()
@Controller('campaigns/:campaignId/invitations')
export class CampaignInvitationsController {
  constructor(private readonly invitations: InvitationService) {}

  @RequirePermission(Permission.CampaignManage)
  @Post()
  invite(
    @CurrentUser() principal: Principal,
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Body() dto: InviteCreatorDto,
  ): Promise<CampaignInvitation> {
    return this.invitations.invite(campaignId, principal.userId, dto.creatorEmail);
  }

  @Get()
  list(
    @CurrentUser() principal: Principal,
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
  ): Promise<CampaignInvitation[]> {
    return this.invitations.listForCampaign(campaignId, principal.userId);
  }

  @RequirePermission(Permission.CampaignManage)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':invitationId')
  revoke(
    @CurrentUser() principal: Principal,
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
  ): Promise<void> {
    return this.invitations.revoke(campaignId, principal.userId, invitationId);
  }
}
