import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiCreatedResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Principal } from '@platform/auth';
import { IMAGE_MAX_BYTES } from '@platform/http/image-upload.constants';
import { acceptImageOnly, ImageUploadExceptionFilter } from '@platform/http/image-upload.filter';
import { Permission, RequirePermission } from '@platform/rbac';
import {
  StartVideoUploadDto,
  UploadedImageDto,
  UploadedVideoDto,
  VideoUploadTicketDto,
} from '../dto/media.dto';
import { UploadsService } from '../services/uploads.service';

@ApiTags('media')
@ApiBearerAuth()
@UseFilters(ImageUploadExceptionFilter)
@Controller('media/uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @RequirePermission(Permission.MediaUpload)
  @Post('images')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: IMAGE_MAX_BYTES, files: 1 },
      fileFilter: acceptImageOnly,
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiCreatedResponse({ type: UploadedImageDto })
  uploadImage(
    @CurrentUser() principal: Principal,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<UploadedImageDto> {
    return this.uploads.storeImage(principal.userId, file);
  }

  /** Reserves a video upload and returns a signed URL to PUT the file to directly. */
  @RequirePermission(Permission.MediaUpload)
  @Post('videos')
  @ApiCreatedResponse({ type: VideoUploadTicketDto })
  startVideoUpload(
    @CurrentUser() principal: Principal,
    @Body() dto: StartVideoUploadDto,
  ): Promise<VideoUploadTicketDto> {
    return this.uploads.startVideoUpload(principal.userId, dto);
  }

  /** Confirms the video arrived in storage; only then can it be submitted. */
  @RequirePermission(Permission.MediaUpload)
  @Post('videos/:assetId/complete')
  @ApiCreatedResponse({ type: UploadedVideoDto })
  completeVideoUpload(
    @CurrentUser() principal: Principal,
    @Param('assetId', ParseUUIDPipe) assetId: string,
  ): Promise<UploadedVideoDto> {
    return this.uploads.completeVideoUpload(principal.userId, assetId);
  }
}
