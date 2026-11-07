import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const count = z.number().int().nonnegative();

export const manualViewsSchema = z.object({
  // Which of the submission's posts the count is for; optional with a single post.
  platform: z.enum(['TIKTOK', 'INSTAGRAM', 'SNAPCHAT', 'YOUTUBE', 'X']).optional(),
  views: count,
  likes: count.optional(),
  comments: count.optional(),
  shares: count.optional(),
});

export class ManualViewsDto extends createZodDto(manualViewsSchema) {}
