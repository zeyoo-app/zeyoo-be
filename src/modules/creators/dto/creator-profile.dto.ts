import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const COUNTRY_PATTERN = /^[A-Z]{2}$/;
const USERNAME_PATTERN = /^[a-z0-9._]{2,30}$/;

const profileFields = z.object({
  displayName: z.string().min(2).max(80),
  username: z.string().toLowerCase().regex(USERNAME_PATTERN, 'Use 2–30 letters, numbers, dots, or underscores.'),
  avatarUrl: z.string().url().optional(),
  headline: z.string().max(120).optional(),
  bio: z.string().max(2000).optional(),
  country: z.string().regex(COUNTRY_PATTERN, 'Must be a 2-letter ISO country code.').optional(),
});

export const createCreatorProfileSchema = profileFields;
export const updateCreatorProfileSchema = profileFields.partial();

export class CreateCreatorProfileDto extends createZodDto(createCreatorProfileSchema) {}
export class UpdateCreatorProfileDto extends createZodDto(updateCreatorProfileSchema) {}
