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
