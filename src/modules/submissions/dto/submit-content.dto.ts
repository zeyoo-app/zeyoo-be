import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const submitContentSchema = z.object({
  contentType: z.enum(['LINK', 'UPLOAD']),
  contentUrl: z.string().url(),
  note: z.string().max(1000).optional(),
});

export class SubmitContentDto extends createZodDto(submitContentSchema) {}
