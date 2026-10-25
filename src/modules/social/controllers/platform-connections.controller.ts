import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SocialPlatform } from '@prisma/client';
import { CurrentUser, Principal } from '@platform/auth';
import { Permission, RequirePermission } from '@platform/rbac';
import {
  ConnectedPlatformAccount,
  PlatformConnectionService,
} from '../application/platform-connection.service';
import {
  CompleteConnectionDto,
  platformParamSchema,
  StartConnectionDto,
} from '../dto/connect-platform.dto';

@ApiTags('social-connections')
@ApiBearerAuth()
@RequirePermission(Permission.CreatorProfileManage)
@Controller('me/social-connections')
export class PlatformConnectionsController {
  constructor(private readonly connections: PlatformConnectionService) {}

  @HttpCode(HttpStatus.OK)
  @Post('complete')
  complete(
    @CurrentUser() principal: Principal,
    @Body() dto: CompleteConnectionDto,
  ): Promise<ConnectedPlatformAccount> {
    return this.connections.completeConnection(principal.userId, dto.code, dto.state);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':platform/start')
  start(
    @CurrentUser() principal: Principal,
    @Param('platform') platform: string,
    @Body() dto: StartConnectionDto,
  ): { authorizationUrl: string } {
    return this.connections.startConnection(
      this.parsePlatform(platform),
      principal.userId,
      dto.client,
    );
  }

  private parsePlatform(raw: string): SocialPlatform {
    const parsed = platformParamSchema.safeParse(raw.toUpperCase());
    if (!parsed.success) {
      throw new BadRequestException(
        'Only Instagram, TikTok, YouTube and Snapchat accounts are connected here.',
      );
    }
    return parsed.data;
  }
}
