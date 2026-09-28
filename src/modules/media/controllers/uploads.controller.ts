import {
  Controller,
  Post,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, Principal } from '@platform/auth';
import { IMAGE_MAX_BYTES } from '@platform/http/image-upload.constants';
import {
  acceptImageOnly,
  ImageUploadExceptionFilter,
} from '@platform/http/image-upload.filter';
import { Permission, RequirePermission } from '@platform/rbac';
import { UploadedImageDto } from '../dto/media.dto';
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
}
