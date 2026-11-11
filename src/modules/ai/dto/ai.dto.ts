import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { campaignBriefOutput } from '../prompts/campaign-brief.v1';
import { contentIdeasOutput } from '../prompts/content-ideas.v1';

const language = z.enum(['en', 'ar']).default('en');
const platform = z.enum(['TIKTOK', 'INSTAGRAM', 'SNAPCHAT', 'YOUTUBE', 'X', 'FACEBOOK']);

export const campaignBriefSchema = z.object({
  /** What the brand is promoting, in its own words. */
  idea: z.string().trim().min(3).max(1000),
  goal: z.string().trim().max(300).optional(),
  title: z.string().trim().max(120).optional(),
  platforms: z.array(platform).max(5).default([]),
  contentType: z.enum(['UGC', 'CLIPPING']).default('UGC'),
  language,
});

export const contentIdeasSchema = z.object({
  campaignId: z.string().uuid(),
  /** Optional steer from the creator: their niche, a style, a constraint. */
  focus: z.string().trim().max(300).optional(),
  language,
});

const resultMeta = z.object({
  provider: z.string(),
  model: z.string(),
  promptVersion: z.string(),
  durationMs: z.number().int(),
});

export class CampaignBriefDto extends createZodDto(campaignBriefSchema) {}
export class ContentIdeasDto extends createZodDto(contentIdeasSchema) {}
export class CampaignBriefResultDto extends createZodDto(
  z.object({ data: campaignBriefOutput, meta: resultMeta }),
) {}
export class ContentIdeasResultDto extends createZodDto(
  z.object({ data: contentIdeasOutput, meta: resultMeta }),
) {}

export const updateAiSettingsSchema = z.object({
  provider: z.enum(['ollama', 'anthropic']),
  model: z.string().trim().min(1).max(200),
});
export class UpdateAiSettingsDto extends createZodDto(updateAiSettingsSchema) {}
