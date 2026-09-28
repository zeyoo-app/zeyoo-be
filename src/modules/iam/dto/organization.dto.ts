import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const createOrganizationSchema = z.object({
  name: z.string().min(2).max(120),
  website: z.string().url().max(2048).optional(),
  industry: z.string().min(2).max(120).optional(),
  logoUrl: z.string().url().max(2048).optional(),
});

export class CreateOrganizationDto extends createZodDto(createOrganizationSchema) {}
