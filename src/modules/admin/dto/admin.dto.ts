import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const createCategorySchema = z.object({
  name: z.string().min(2).max(80),
});

export const addStaffSchema = z.object({
  email: z.string().trim().email().max(254),
});

export const rejectVerificationSchema = z.object({
  note: z.string().trim().min(5).max(500),
});

export class CreateCategoryDto extends createZodDto(createCategorySchema) {}
export class AddStaffDto extends createZodDto(addStaffSchema) {}
export class RejectVerificationDto extends createZodDto(rejectVerificationSchema) {}
