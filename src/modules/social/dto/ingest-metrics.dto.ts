import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const count = z.number().int().nonnegative();

export const ingestMetricsSchema = z.object({
  creatorUserId: z.string().uuid(),
  platform: z.enum(['TIKTOK', 'INSTAGRAM', 'YOUTUBE', 'X']),
  views: count,
  likes: count,
  comments: count,
  shares: count,
});

export class IngestMetricsDto extends createZodDto(ingestMetricsSchema) {}
