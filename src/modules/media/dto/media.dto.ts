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
