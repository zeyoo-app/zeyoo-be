import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Clip, MediaAsset } from '@prisma/client';
import { CurrentUser, Principal } from '@platform/auth';
import { CreateClipDto, RegisterAssetDto } from '../dto/media.dto';
import { MediaAssetWithClips, MediaService } from '../services/media.service';

@ApiTags('media')
@ApiBearerAuth()
@Controller('media/assets')
export class MediaAssetsController {
  constructor(private readonly media: MediaService) {}

  @Post()
  register(
    @CurrentUser() principal: Principal,
    @Body() dto: RegisterAssetDto,
  ): Promise<MediaAsset> {
    return this.media.registerAsset(principal.userId, dto);
  }

  @Get(':assetId')
  get(
    @CurrentUser() principal: Principal,
    @Param('assetId', ParseUUIDPipe) assetId: string,
  ): Promise<MediaAssetWithClips> {
    return this.media.getOwned(principal.userId, assetId);
  }

  @Post(':assetId/clips')
  createClip(
    @CurrentUser() principal: Principal,
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @Body() dto: CreateClipDto,
  ): Promise<Clip> {
    return this.media.requestClip(principal.userId, assetId, dto);
  }
}
