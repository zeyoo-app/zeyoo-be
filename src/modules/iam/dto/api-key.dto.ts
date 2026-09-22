import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const createApiKeySchema = z.object({
  name: z.string().min(2).max(80),
  scopes: z.array(z.string().min(1)).min(1),
});

export class CreateApiKeyDto extends createZodDto(createApiKeySchema) {}
