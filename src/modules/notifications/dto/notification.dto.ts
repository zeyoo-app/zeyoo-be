import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const updatePreferencesSchema = z
  .object({
    emailEnabled: z.boolean(),
    pushEnabled: z.boolean(),
    submissionUpdates: z.boolean(),
    payoutUpdates: z.boolean(),
    campaignInvites: z.boolean(),
    productNews: z.boolean(),
  })
  .partial();

export class UpdatePreferencesDto extends createZodDto(updatePreferencesSchema) {}
