import { z } from 'zod';
import { AiLanguage, languageInstruction, PromptTemplate } from './prompt-template';

export const contentIdeasOutput = z
  .object({
    ideas: z
      .array(
        z
          .object({
            title: z.string().min(3).max(80).describe('A short name for the idea.'),
            hook: z.string().min(5).max(200).describe('The opening line or first-seconds moment.'),
            talkingPoints: z
              .array(z.string().min(3).max(160))
              .min(2)
              .max(4)
              .describe('What to say or show after the hook.'),
            format: z
              .string()
              .min(3)
              .max(80)
              .describe('The shape of the post, such as a 30-second talking-head video.'),
          })
          .strict(),
      )
      .min(3)
      .max(3),
  })
  .strict();

export type ContentIdeas = z.infer<typeof contentIdeasOutput>;

export interface ContentIdeasContext {
  campaign: {
    title: string;
    brief: string;
    goals?: string | null;
    audience?: string | null;
    guidelines?: string | null;
    hashtags: string[];
    platforms: string[];
    contentType: 'UGC' | 'CLIPPING';
  };
  creator?: { displayName: string; headline?: string | null; bio?: string | null };
  /** Anything the creator typed to steer the ideas (their niche, a style, a constraint). */
  focus?: string;
  language: AiLanguage;
}

export const contentIdeasV1: PromptTemplate<ContentIdeasContext, ContentIdeas> = {
  id: 'content-ideas',
  version: 1,
  temperature: 0.8,
  system: [
    'You are a content coach for social media creators on Zeyoo.',
    "Suggest post ideas that fit the brand's campaign brief and rules, and that suit the creator.",
    'Every idea must respect the content rules and use the required hashtags where it mentions hashtags.',
    'Do not invent product facts, prices or claims that are not in the brief.',
    'Reply with a single JSON object that matches the requested schema and nothing else.',
  ].join('\n'),
  renderTask: ({ campaign, creator, focus, language }) =>
    [
      `Campaign: ${campaign.title}`,
      `Brief: ${campaign.brief}`,
      campaign.goals ? `Goals: ${campaign.goals}` : null,
      campaign.audience ? `Audience: ${campaign.audience}` : null,
      campaign.guidelines ? `Content rules:\n${campaign.guidelines}` : null,
      campaign.hashtags.length ? `Required hashtags: ${campaign.hashtags.join(' ')}` : null,
      `Platforms: ${campaign.platforms.join(', ')}`,
      `Content type: ${campaign.contentType === 'CLIPPING' ? 'clips cut from brand footage' : 'original creator video'}`,
      creator
        ? `Creator: ${[creator.displayName, creator.headline, creator.bio].filter(Boolean).join(' — ')}`
        : null,
      focus ? `The creator asked for: ${focus}` : null,
      '',
      'Give exactly 3 distinct ideas, each with a title, a hook, 2 to 4 talking points and a format.',
      languageInstruction(language),
    ]
      .filter((line) => line !== null)
      .join('\n'),
  output: contentIdeasOutput,
};
