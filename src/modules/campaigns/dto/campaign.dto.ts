import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const TITLE_MIN = 3;
const TITLE_MAX = 140;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

const platformSchema = z.enum(['TIKTOK', 'INSTAGRAM', 'SNAPCHAT', 'YOUTUBE', 'X']);
const visibilitySchema = z.enum(['PUBLIC', 'PRIVATE']);
const rewardTypeSchema = z.enum(['FIXED_PER_ITEM', 'PER_VIEW']);
const contentTypeSchema = z.enum(['UGC', 'CLIPPING']);

const tagSchema = z.string().trim().min(1).max(100);
const referenceMaterialSchema = z.object({
  name: z.string().trim().min(1).max(200),
  url: z.string().url().max(2048),
});

const campaignFields = z.object({
  title: z.string().min(TITLE_MIN).max(TITLE_MAX),
  description: z.string().min(1).max(5000),
  goals: z.string().max(2000).optional(),
  audience: z.string().max(2000).optional(),
  guidelines: z.string().max(5000).optional(),
  hashtags: z.array(tagSchema).max(30).optional(),
  mentions: z.array(tagSchema).max(30).optional(),
  referenceMaterials: z.array(referenceMaterialSchema).max(10).optional(),
  coverImageUrl: z.string().url().max(2048).optional(),
  // Either `platforms` (preferred) or the legacy single `platform`; the service stores both.
  platform: platformSchema.optional(),
  platforms: z.array(platformSchema).min(1).max(5).optional(),
  contentType: contentTypeSchema.default('UGC'),
  categoryId: z.string().uuid().optional(),
  visibility: visibilitySchema.default('PUBLIC'),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  currencyCode: z.string().regex(CURRENCY_PATTERN, 'Must be a 3-letter ISO currency code.'),
  budgetAmount: z.number().int().positive(),
  rewardType: rewardTypeSchema,
  rewardAmount: z.number().int().positive(),
  maxRewardPerCreatorAmount: z.number().int().positive().optional(),
});

const endsAfterStart = (value: { startDate: Date; endDate: Date }): boolean =>
  value.endDate > value.startDate;
const endsAfterStartMessage = { message: 'endDate must be after startDate.', path: ['endDate'] };

export const createCampaignSchema = campaignFields
  .refine(endsAfterStart, endsAfterStartMessage)
  .refine((value) => Boolean(value.platform ?? value.platforms?.length), {
    message: 'Choose at least one platform.',
    path: ['platforms'],
  })
  .refine(
    (value) =>
      !value.maxRewardPerCreatorAmount || value.maxRewardPerCreatorAmount <= value.budgetAmount,
    {
      message: 'The per-creator maximum cannot exceed the total budget.',
      path: ['maxRewardPerCreatorAmount'],
    },
  );

// Only content and scheduling fields are editable, and only while DRAFT (the
// service enforces the status guard). Date ordering is re-checked there because
// either bound may be omitted on an update.
export const updateCampaignSchema = campaignFields.partial();

export class CreateCampaignDto extends createZodDto(createCampaignSchema) {}
export class UpdateCampaignDto extends createZodDto(updateCampaignSchema) {}
