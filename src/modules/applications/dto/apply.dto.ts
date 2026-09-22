import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const applyToCampaignSchema = z.object({
  acceptedTerms: z.literal(true, {
    errorMap: () => ({ message: 'You must accept the campaign terms to apply.' }),
  }),
  message: z.string().max(1000).optional(),
});

export class ApplyToCampaignDto extends createZodDto(applyToCampaignSchema) {}
