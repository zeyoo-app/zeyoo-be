import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const TITLE_MIN = 3;
const TITLE_MAX = 140;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

const platformSchema = z.enum(['TIKTOK', 'INSTAGRAM', 'YOUTUBE', 'X']);
const visibilitySchema = z.enum(['PUBLIC', 'PRIVATE']);
const rewardTypeSchema = z.enum(['FIXED_PER_ITEM', 'PER_VIEW']);

const campaignFields = z.object({
  title: z.string().min(TITLE_MIN).max(TITLE_MAX),
  description: z.string().min(1).max(5000),
  goals: z.string().max(2000).optional(),
  audience: z.string().max(2000).optional(),
  guidelines: z.string().max(5000).optional(),
  platform: platformSchema,
  categoryId: z.string().uuid().optional(),
  visibility: visibilitySchema.default('PRIVATE'),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  currencyCode: z.string().regex(CURRENCY_PATTERN, 'Must be a 3-letter ISO currency code.'),
  budgetAmount: z.number().int().positive(),
  rewardType: rewardTypeSchema,
  rewardAmount: z.number().int().positive(),
});

const endsAfterStart = (value: { startDate: Date; endDate: Date }): boolean =>
  value.endDate > value.startDate;
const endsAfterStartMessage = { message: 'endDate must be after startDate.', path: ['endDate'] };

export const createCampaignSchema = campaignFields.refine(endsAfterStart, endsAfterStartMessage);

// Only content and scheduling fields are editable, and only while DRAFT (the
// service enforces the status guard). Date ordering is re-checked there because
// either bound may be omitted on an update.
export const updateCampaignSchema = campaignFields.partial();

export class CreateCampaignDto extends createZodDto(createCampaignSchema) {}
export class UpdateCampaignDto extends createZodDto(updateCampaignSchema) {}
