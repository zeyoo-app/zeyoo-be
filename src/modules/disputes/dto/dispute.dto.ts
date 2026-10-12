import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const openDisputeSchema = z
  .object({
    subjectType: z.enum(['WITHDRAWAL', 'SUBMISSION', 'CAMPAIGN', 'FRAUD_CASE', 'OTHER']),
    subjectId: z.string().uuid().optional(),
    reason: z.string().trim().min(5).max(2000),
  })
  .refine((value) => value.subjectType === 'OTHER' || value.subjectId !== undefined, {
    message: 'Choose what this dispute is about.',
    path: ['subjectId'],
  });

export const disputeMessageSchema = z.object({
  message: z.string().trim().min(1).max(2000),
});

export const disputeDecisionSchema = z.object({
  outcome: z.enum(['UPHELD', 'DENIED']),
  note: z.string().trim().min(3).max(2000),
});

export class OpenDisputeDto extends createZodDto(openDisputeSchema) {}
export class DisputeMessageDto extends createZodDto(disputeMessageSchema) {}
export class DisputeDecisionDto extends createZodDto(disputeDecisionSchema) {}
