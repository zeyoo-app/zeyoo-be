import { z } from 'zod';
import { AiLanguage, languageInstruction, PromptTemplate } from './prompt-template';

export const campaignBriefOutput = z
  .object({
    brief: z
      .string()
      .min(40)
      .max(1500)
      .describe(
        'What creators should make: the concept, the key message and how to show the product.',
      ),
    goals: z
      .string()
      .min(5)
      .max(400)
      .describe('What the campaign should achieve, in one or two sentences.'),
    audience: z.string().min(5).max(300).describe('Who the content is for.'),
    contentRules: z
      .array(z.string().min(3).max(160))
      .min(2)
      .max(5)
      .describe('Short, checkable rules every post must follow.'),
    hashtags: z.array(z.string().min(2).max(40)).min(1).max(5).describe('Hashtags to include.'),
  })
  .strict();

export type CampaignBriefDraft = z.infer<typeof campaignBriefOutput>;

export interface CampaignBriefContext {
  /** The brand running the campaign; the brief must name it, never the marketplace. */
  brandName?: string;
  idea: string;
  goal?: string;
  title?: string;
  platforms: string[];
  contentType: 'UGC' | 'CLIPPING';
  language: AiLanguage;
}

const CONTENT_TYPE_LABELS: Record<CampaignBriefContext['contentType'], string> = {
  UGC: 'original user-generated videos made by each creator',
  CLIPPING: 'short clips cut from long-form content the brand provides',
};

export const campaignBriefV1: PromptTemplate<CampaignBriefContext, CampaignBriefDraft> = {
  id: 'campaign-brief',
  version: 1,
  temperature: 0.6,
  system: [
    'You are a campaign strategist helping a brand on Zeyoo, a marketplace where brands pay social media creators for posts.',
    "Turn the brand's short idea into a first-draft campaign brief that creators can act on.",
    'The campaign belongs to the brand, not to Zeyoo: refer to the brand by its name (or as "the brand"), and never present Zeyoo as the company behind the product.',
    'Be concrete and specific to the product; never invent prices, discounts, claims or facts the brand did not give.',
    'Write for creators: plain words, no marketing jargon.',
    'Reply with a single JSON object that matches the requested schema and nothing else.',
  ].join('\n'),
  renderTask: (context) =>
    [
      context.brandName ? `Brand: ${context.brandName}` : null,
      `Brand idea: ${context.idea}`,
      context.goal ? `Brand goal: ${context.goal}` : null,
      context.title ? `Working campaign title: ${context.title}` : null,
      `Platforms: ${context.platforms.join(', ') || 'any'}`,
      `Content: ${CONTENT_TYPE_LABELS[context.contentType]}`,
      '',
      'Write the brief (3 to 6 sentences), the goals, the target audience, 2 to 5 content rules and up to 5 hashtags.',
      languageInstruction(context.language),
    ]
      .filter((line) => line !== null)
      .join('\n'),
  output: campaignBriefOutput,
};
