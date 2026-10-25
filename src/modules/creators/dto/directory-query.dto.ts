import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const platformSchema = z.enum(['TIKTOK', 'INSTAGRAM', 'SNAPCHAT', 'YOUTUBE', 'X']);

export const directoryQuerySchema = z.object({
  platform: platformSchema.optional(),
  // Query strings are text: only "true" turns the filter on (z.coerce would read "false" as true).
  verifiedOnly: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

export class DirectoryQueryDto extends createZodDto(directoryQuerySchema) {}
