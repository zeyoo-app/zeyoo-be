import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const createOrganizationSchema = z.object({
  name: z.string().min(2).max(120),
});

export class CreateOrganizationDto extends createZodDto(createOrganizationSchema) {}
