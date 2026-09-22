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
import { SocialAccount } from '@prisma/client';
import { CurrentUser, Principal } from '@platform/auth';
import { Permission, RequirePermission } from '@platform/rbac';
import { ConnectSocialAccountDto } from '../dto/social-account.dto';
import { SocialAccountService } from '../services/social-account.service';

@ApiTags('creator-social-accounts')
@ApiBearerAuth()
@RequirePermission(Permission.CreatorProfileManage)
@Controller('creator-profile/social-accounts')
export class CreatorSocialAccountsController {
  constructor(private readonly socialAccounts: SocialAccountService) {}

  @Get()
  list(@CurrentUser() principal: Principal): Promise<SocialAccount[]> {
    return this.socialAccounts.list(principal.userId);
  }

  @Post()
  connect(
    @CurrentUser() principal: Principal,
    @Body() dto: ConnectSocialAccountDto,
  ): Promise<SocialAccount> {
    return this.socialAccounts.connect(principal.userId, dto);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':socialAccountId')
  disconnect(
    @CurrentUser() principal: Principal,
    @Param('socialAccountId', ParseUUIDPipe) socialAccountId: string,
  ): Promise<void> {
    return this.socialAccounts.disconnect(principal.userId, socialAccountId);
  }
}
