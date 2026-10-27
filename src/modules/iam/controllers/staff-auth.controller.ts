import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { StaffRole } from '@prisma/client';
import { CurrentUser, Principal, Public } from '@platform/auth';
import { Permission, RequirePermission } from '@platform/rbac';
import { LogoutDto, RefreshDto, RequestStaffCodeDto, VerifyStaffCodeDto } from '../dto/auth.dto';
import { AuthService } from '../services/auth.service';
import { StaffService } from '../services/staff.service';
import { AuthTokens } from '../services/token.service';

export interface StaffMe {
  id: string;
  email: string;
  role: StaffRole;
}

/** Back-office sign-in. Staff accounts are added by a super admin, never signed up. */
@ApiTags('admin-auth')
@Controller('admin/auth')
export class StaffAuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly staff: StaffService,
  ) {}

  // Answers the same whether or not the address has back-office access.
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('code')
  async requestCode(@Body() dto: RequestStaffCodeDto): Promise<{ message: string }> {
    await this.auth.requestStaffCode(dto.email);
    return { message: 'If this email has back-office access, a 6-digit code is on its way.' };
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('code/verify')
  verifyCode(@Body() dto: VerifyStaffCodeDto): Promise<AuthTokens> {
    return this.auth.verifyStaffCode(dto.email, dto.code);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  refresh(@Body() dto: RefreshDto): Promise<AuthTokens> {
    return this.auth.refreshStaff(dto.refreshToken);
  }

  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  logout(@Body() dto: LogoutDto): Promise<void> {
    return this.auth.logoutStaff(dto.refreshToken);
  }

  @ApiBearerAuth()
  @RequirePermission(Permission.AdminAccess)
  @Get('me')
  async me(@CurrentUser() principal: Principal): Promise<StaffMe> {
    const staff = await this.staff.findById(principal.userId);
    if (!staff || staff.status !== 'ACTIVE') {
      throw new NotFoundException('Staff account not found.');
    }
    return { id: staff.id, email: staff.email, role: staff.role };
  }
}
