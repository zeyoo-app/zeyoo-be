import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const count = z.number().int().nonnegative();

export const assessEngagementSchema = z.object({
  views: count,
  likes: count,
  comments: count,
  shares: count,
});

export const flagFraudSchema = z.object({
  creatorUserId: z.string().uuid(),
  level: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  note: z.string().max(1000).optional(),
});

export class AssessEngagementDto extends createZodDto(assessEngagementSchema) {}
export class FlagFraudDto extends createZodDto(flagFraudSchema) {}
