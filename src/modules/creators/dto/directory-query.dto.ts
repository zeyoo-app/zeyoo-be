import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const platformSchema = z.enum(['TIKTOK', 'INSTAGRAM', 'YOUTUBE', 'X']);

export const directoryQuerySchema = z.object({
  platform: platformSchema.optional(),
  verifiedOnly: z.coerce.boolean().optional(),
});

export class DirectoryQueryDto extends createZodDto(directoryQuerySchema) {}
