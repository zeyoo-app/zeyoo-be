import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CreatorProfile } from '@prisma/client';
import { CurrentUser, Principal } from '@platform/auth';
import { Permission, RequirePermission } from '@platform/rbac';
import { CreateCreatorProfileDto, UpdateCreatorProfileDto } from '../dto/creator-profile.dto';
import { CreatorProfileService } from '../services/creator-profile.service';

@ApiTags('creator-profile')
@ApiBearerAuth()
@RequirePermission(Permission.CreatorProfileManage)
@Controller('creator-profile')
export class CreatorProfileController {
  constructor(private readonly profiles: CreatorProfileService) {}

  @Post()
  create(
    @CurrentUser() principal: Principal,
    @Body() dto: CreateCreatorProfileDto,
  ): Promise<CreatorProfile> {
    return this.profiles.create(principal.userId, dto);
  }

  @Get()
  getOwn(@CurrentUser() principal: Principal): Promise<CreatorProfile> {
    return this.profiles.getOwn(principal.userId);
  }

  @Patch()
  update(
    @CurrentUser() principal: Principal,
    @Body() dto: UpdateCreatorProfileDto,
  ): Promise<CreatorProfile> {
    return this.profiles.update(principal.userId, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('verification')
  requestVerification(@CurrentUser() principal: Principal): Promise<CreatorProfile> {
    return this.profiles.requestVerification(principal.userId);
  }
}
