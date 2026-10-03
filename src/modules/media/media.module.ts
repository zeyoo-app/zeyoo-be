import { Module } from '@nestjs/common';
import { MediaAssetsController } from './controllers/media-assets.controller';
import { MyMediaController } from './controllers/my-media.controller';
import { UploadsController } from './controllers/uploads.controller';
import { MediaService } from './services/media.service';
import { UploadsService } from './services/uploads.service';
import { ImageStorage } from './storage/image-storage';
import { R2ImageStorage } from './storage/r2-image-storage';

@Module({
  controllers: [MediaAssetsController, MyMediaController, UploadsController],
  providers: [MediaService, UploadsService, { provide: ImageStorage, useClass: R2ImageStorage }],
  exports: [MediaService, UploadsService],
})
export class MediaModule {}
