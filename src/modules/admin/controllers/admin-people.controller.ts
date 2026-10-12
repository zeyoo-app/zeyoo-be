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
import { AddStaffDto, RejectVerificationDto } from '../dto/admin.dto';
import { Page } from '../services/admin-read.service';
import {
  AdminPeopleService,
  StaffRow,
  UserDetail,
  VerificationRow,
} from '../services/admin-people.service';

@ApiTags('admin')
@ApiBearerAuth()
@RequirePermission(Permission.AdminAccess)
@Controller('admin')
export class AdminPeopleController {
  constructor(private readonly people: AdminPeopleService) {}

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

  @Get('staff')
  staff(@CurrentUser() principal: Principal): Promise<StaffRow[]> {
    return this.people.staff(principal.userId);
  }

  @Post('staff')
  addStaff(@Body() dto: AddStaffDto): Promise<StaffRow> {
    return this.people.addStaff(dto.email);
  }

  @HttpCode(HttpStatus.OK)
  @Post('staff/:userId/deactivate')
  async deactivateStaff(
    @CurrentUser() principal: Principal,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    await this.people.deactivateStaff(userId, principal.userId);
  }

  @HttpCode(HttpStatus.OK)
  @Post('staff/:userId/reactivate')
  async reactivateStaff(@Param('userId', ParseUUIDPipe) userId: string): Promise<void> {
    await this.people.reactivateStaff(userId);
  }
}
