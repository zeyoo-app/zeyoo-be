import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const subscribeSchema = z.object({
  planKey: z.string().min(1),
});

export class SubscribeDto extends createZodDto(subscribeSchema) {}
