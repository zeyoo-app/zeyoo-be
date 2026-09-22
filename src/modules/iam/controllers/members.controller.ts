import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Membership } from '@prisma/client';
import { CurrentUser, Principal } from '@platform/auth';
import { Permission, RequirePermission } from '@platform/rbac';
import { InviteMemberDto, UpdateMemberRoleDto } from '../dto/membership.dto';
import { MemberWithUser, MembershipService } from '../services/membership.service';

@ApiTags('members')
@ApiBearerAuth()
@Controller('organizations/:organizationId/members')
export class MembersController {
  constructor(private readonly memberships: MembershipService) {}

  @Get()
  list(
    @CurrentUser() principal: Principal,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
  ): Promise<MemberWithUser[]> {
    return this.memberships.listMembers(organizationId, principal.userId);
  }

  @RequirePermission(Permission.OrgMembersManage)
  @Post()
  invite(
    @CurrentUser() principal: Principal,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: InviteMemberDto,
  ): Promise<Membership> {
    return this.memberships.invite(organizationId, principal.userId, dto.email, dto.role);
  }

  @RequirePermission(Permission.OrgMembersManage)
  @Patch(':membershipId')
  updateRole(
    @CurrentUser() principal: Principal,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body() dto: UpdateMemberRoleDto,
  ): Promise<Membership> {
    return this.memberships.updateRole(organizationId, principal.userId, membershipId, dto.role);
  }

  @RequirePermission(Permission.OrgMembersManage)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':membershipId')
  remove(
    @CurrentUser() principal: Principal,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
  ): Promise<void> {
    return this.memberships.remove(organizationId, principal.userId, membershipId);
  }
}
