import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const openDisputeSchema = z.object({
  subjectType: z.enum(['WITHDRAWAL', 'SUBMISSION', 'CAMPAIGN', 'OTHER']),
  subjectId: z.string().uuid().optional(),
  reason: z.string().min(1).max(2000),
});

export const disputeMessageSchema = z.object({
  message: z.string().min(1).max(2000),
});

export class OpenDisputeDto extends createZodDto(openDisputeSchema) {}
export class DisputeMessageDto extends createZodDto(disputeMessageSchema) {}
