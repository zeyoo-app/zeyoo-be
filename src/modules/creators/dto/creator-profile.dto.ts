import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const COUNTRY_PATTERN = /^[A-Z]{2}$/;

const profileFields = z.object({
  displayName: z.string().min(2).max(80),
  headline: z.string().max(120).optional(),
  bio: z.string().max(2000).optional(),
  country: z.string().regex(COUNTRY_PATTERN, 'Must be a 2-letter ISO country code.').optional(),
});

export const createCreatorProfileSchema = profileFields;
export const updateCreatorProfileSchema = profileFields.partial();

export class CreateCreatorProfileDto extends createZodDto(createCreatorProfileSchema) {}
export class UpdateCreatorProfileDto extends createZodDto(updateCreatorProfileSchema) {}
