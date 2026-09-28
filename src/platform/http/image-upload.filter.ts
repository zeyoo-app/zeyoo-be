import { BadRequestException } from '@nestjs/common';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { MulterError } from 'multer';

import { IMAGE_MAX_BYTES } from './image-upload.constants';

/**
 * Multer rejects a bad upload by throwing its own error, which is not an
 * HttpException — without this it would surface as an opaque 500. Translated
 * here to the same body shape as AllExceptionsFilter.
 */
@Catch(MulterError)
export class ImageUploadExceptionFilter implements ExceptionFilter {
  catch(exception: MulterError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const tooLarge = exception.code === 'LIMIT_FILE_SIZE';
    const status = tooLarge
      ? HttpStatus.PAYLOAD_TOO_LARGE
      : HttpStatus.BAD_REQUEST;
    const message = tooLarge
      ? `Images must be ${Math.floor(IMAGE_MAX_BYTES / (1024 * 1024))} MB or smaller.`
      : exception.code === 'LIMIT_UNEXPECTED_FILE'
        ? 'Attach the image in the "file" field.'
        : exception.message;

    response.status(status).json({
      statusCode: status,
      error: HttpStatus[status] ?? 'ERROR',
      message,
      path: host.switchToHttp().getRequest<{ url: string }>().url,
      timestamp: new Date().toISOString(),
    });
  }
}

/** Rejects non-image parts before they are buffered, as a 400. */
export function acceptImageOnly(
  _request: unknown,
  file: Express.Multer.File,
  callback: (error: Error | null, acceptFile: boolean) => void,
): void {
  if (!file.mimetype.startsWith('image/')) {
    callback(new BadRequestException('Images must be JPEG, PNG, WebP or HEIC.'), false);
    return;
  }
  callback(null, true);
}
