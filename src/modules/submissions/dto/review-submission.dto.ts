import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const reviewSubmissionSchema = z.object({
  decision: z.enum(['APPROVED', 'CHANGES_REQUESTED', 'REJECTED']),
  note: z.string().max(1000).optional(),
});

export class ReviewSubmissionDto extends createZodDto(reviewSubmissionSchema) {}
