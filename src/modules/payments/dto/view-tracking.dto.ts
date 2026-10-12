import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const count = z.number().int().nonnegative();

export const manualViewsSchema = z.object({
  views: count,
  likes: count.optional(),
  comments: count.optional(),
  shares: count.optional(),
});

export class ManualViewsDto extends createZodDto(manualViewsSchema) {}
