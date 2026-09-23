import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const createCategorySchema = z.object({
  name: z.string().min(2).max(80),
});

export class CreateCategoryDto extends createZodDto(createCategorySchema) {}
