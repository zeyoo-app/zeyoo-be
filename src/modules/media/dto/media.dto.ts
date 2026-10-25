import { ApiProperty } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const registerAssetSchema = z.object({
  kind: z.enum(['VIDEO', 'AUDIO', 'IMAGE']),
  sourceUrl: z.string().url(),
});

export const createClipSchema = z
  .object({
    startSeconds: z.number().int().nonnegative(),
    endSeconds: z.number().int().positive(),
  })
  .refine((value) => value.endSeconds > value.startSeconds, {
    message: 'endSeconds must be after startSeconds.',
    path: ['endSeconds'],
  });

export const VIDEO_CONTENT_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'] as const;

export const startVideoUploadSchema = z.object({
  contentType: z.enum(VIDEO_CONTENT_TYPES, {
    errorMap: () => ({ message: 'Videos must be MP4, MOV or WebM.' }),
  }),
  size: z.number().int().positive(),
});

export class StartVideoUploadDto extends createZodDto(startVideoUploadSchema) {}

export class RegisterAssetDto extends createZodDto(registerAssetSchema) {}
export class CreateClipDto extends createZodDto(createClipSchema) {}

/** What the client gets back after an upload: a URL it can persist on a record. */
export class UploadedImageDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uri' })
  url!: string;

  /** Path segment under the static asset prefix — the file name on disk. */
  @ApiProperty()
  key!: string;

  @ApiProperty({ example: 'image/png' })
  contentType!: string;

  @ApiProperty({ description: 'Stored size in bytes.' })
  size!: number;
}

/** Where to send the video bytes, and the URL the video will have once uploaded. */
export class VideoUploadTicketDto {
  @ApiProperty({ format: 'uuid', description: 'Media asset id; pass it to complete the upload.' })
  id!: string;

  @ApiProperty({ format: 'uri', description: 'PUT the file here with the declared Content-Type.' })
  uploadUrl!: string;

  @ApiProperty({ description: 'Headers the PUT must carry.' })
  uploadHeaders!: Record<string, string>;

  @ApiProperty({ format: 'uri' })
  url!: string;

  @ApiProperty()
  expiresAt!: string;
}

export class UploadedVideoDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uri' })
  url!: string;

  @ApiProperty({ example: 'video/mp4' })
  contentType!: string;

  @ApiProperty({ description: 'Stored size in bytes.' })
  size!: number;
}
