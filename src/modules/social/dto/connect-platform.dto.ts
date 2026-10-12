import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const platformParamSchema = z.enum(['TIKTOK', 'INSTAGRAM']);

export const startConnectionSchema = z.object({
  // 'app' makes the callback page hand the code back to the mobile app.
  client: z.enum(['web', 'app']).default('web'),
});

export const completeConnectionSchema = z.object({
  code: z.string().min(1).max(2048),
  state: z.string().min(1).max(4096),
});

export class StartConnectionDto extends createZodDto(startConnectionSchema) {}
export class CompleteConnectionDto extends createZodDto(completeConnectionSchema) {}
