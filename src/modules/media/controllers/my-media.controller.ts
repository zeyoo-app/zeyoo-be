import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { MediaAsset } from '@prisma/client';
import { CurrentUser, Principal } from '@platform/auth';
import { MediaService } from '../services/media.service';

@ApiTags('media')
@ApiBearerAuth()
@Controller('me/media/assets')
export class MyMediaController {
  constructor(private readonly media: MediaService) {}

  @Get()
  list(@CurrentUser() principal: Principal): Promise<MediaAsset[]> {
    return this.media.listOwn(principal.userId);
  }
}
