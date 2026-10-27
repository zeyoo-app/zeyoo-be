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
import { StaffRole, StaffStatus } from '@prisma/client';
import { CurrentUser, Principal } from '@platform/auth';
import { Permission, RequirePermission } from '@platform/rbac';
import { AddStaffDto, RejectVerificationDto } from '../dto/admin.dto';
import { Page } from '../services/admin-read.service';
import { StaffService } from '@modules/iam/iam.public';
import { AdminPeopleService, UserDetail, VerificationRow } from '../services/admin-people.service';

export interface StaffRow {
  id: string;
  email: string;
  role: StaffRole;
  status: StaffStatus;
  lastSignInAt: Date | null;
  createdAt: Date;
  isYou: boolean;
}

@ApiTags('admin')
@ApiBearerAuth()
@RequirePermission(Permission.AdminAccess)
@Controller('admin')
export class AdminPeopleController {
  constructor(
    private readonly people: AdminPeopleService,
    private readonly staffAccounts: StaffService,
  ) {}

  @Get('users/:userId')
  userDetail(@Param('userId', ParseUUIDPipe) userId: string): Promise<UserDetail> {
    return this.people.userDetail(userId);
  }

  @Get('verifications')
  verifications(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<Page<VerificationRow>> {
    return this.people.verifications({
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @HttpCode(HttpStatus.OK)
  @Post('verifications/:userId/approve')
  async approveVerification(@Param('userId', ParseUUIDPipe) userId: string): Promise<void> {
    await this.people.approveVerification(userId);
  }

  @HttpCode(HttpStatus.OK)
  @Post('verifications/:userId/reject')
  async rejectVerification(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: RejectVerificationDto,
  ): Promise<void> {
    await this.people.rejectVerification(userId, dto.note);
  }

  @RequirePermission(Permission.AdminAccess, Permission.StaffManage)
  @Get('staff')
  async staff(@CurrentUser() principal: Principal): Promise<StaffRow[]> {
    const staff = await this.staffAccounts.list();
    return staff.map((member) => ({
      id: member.id,
      email: member.email,
      role: member.role,
      status: member.status,
      lastSignInAt: member.lastSignInAt,
      createdAt: member.createdAt,
      isYou: member.id === principal.userId,
    }));
  }

  // Super admin is the only role for now; more roles arrive with their own privileges.
  @RequirePermission(Permission.AdminAccess, Permission.StaffManage)
  @Post('staff')
  async addStaff(@CurrentUser() principal: Principal, @Body() dto: AddStaffDto): Promise<void> {
    await this.staffAccounts.add(dto.email, 'SUPER_ADMIN', principal.userId);
  }

  @RequirePermission(Permission.AdminAccess, Permission.StaffManage)
  @HttpCode(HttpStatus.OK)
  @Post('staff/:staffId/deactivate')
  async deactivateStaff(
    @CurrentUser() principal: Principal,
    @Param('staffId', ParseUUIDPipe) staffId: string,
  ): Promise<void> {
    await this.staffAccounts.deactivate(staffId, principal.userId);
  }

  @RequirePermission(Permission.AdminAccess, Permission.StaffManage)
  @HttpCode(HttpStatus.OK)
  @Post('staff/:staffId/reactivate')
  async reactivateStaff(@Param('staffId', ParseUUIDPipe) staffId: string): Promise<void> {
    await this.staffAccounts.reactivate(staffId);
  }
}
