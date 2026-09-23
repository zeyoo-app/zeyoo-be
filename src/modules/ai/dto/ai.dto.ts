import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const campaignBriefSchema = z.object({
  idea: z.string().min(3).max(2000),
});

export const contentIdeasSchema = z.object({
  topic: z.string().min(3).max(500),
});

export class CampaignBriefDto extends createZodDto(campaignBriefSchema) {}
export class ContentIdeasDto extends createZodDto(contentIdeasSchema) {}
