import { Module } from '@nestjs/common';
import { MediaAssetsController } from './controllers/media-assets.controller';
import { MyMediaController } from './controllers/my-media.controller';
import { MediaService } from './services/media.service';

@Module({
  controllers: [MediaAssetsController, MyMediaController],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}
