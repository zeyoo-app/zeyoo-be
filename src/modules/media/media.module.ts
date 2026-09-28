import { Module } from '@nestjs/common';
import { MediaAssetsController } from './controllers/media-assets.controller';
import { MyMediaController } from './controllers/my-media.controller';
import { UploadsController } from './controllers/uploads.controller';
import { MediaService } from './services/media.service';
import { UploadsService } from './services/uploads.service';

@Module({
  controllers: [MediaAssetsController, MyMediaController, UploadsController],
  providers: [MediaService, UploadsService],
  exports: [MediaService, UploadsService],
})
export class MediaModule {}
