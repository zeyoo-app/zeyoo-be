import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '@platform/database/prisma.service';
import { AI_PROVIDER, AiProviderPort } from '../ports/ai-provider.port';

const BRIEF_SYSTEM =
  'You are a marketing strategist. Turn the brand idea into a concise, editable ' +
  'first-draft campaign brief with goals, audience, and content guidelines.';
const IDEAS_SYSTEM =
  'You are a creator coach. Given a topic, suggest content ideas, hooks, and ' +
  'talking points a creator can use.';

export interface AiResult {
  response: string;
}

@Injectable()
export class AiAssistantService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AI_PROVIDER) private readonly provider: AiProviderPort,
  ) {}

  draftCampaignBrief(userId: string, idea: string): Promise<AiResult> {
    return this.run(userId, 'CAMPAIGN_BRIEF', BRIEF_SYSTEM, idea);
  }

  suggestContentIdeas(userId: string, topic: string): Promise<AiResult> {
    return this.run(userId, 'CONTENT_IDEAS', IDEAS_SYSTEM, topic);
  }

  private async run(
    userId: string,
    kind: string,
    system: string,
    prompt: string,
  ): Promise<AiResult> {
    const response = await this.provider.generate({ system, prompt });
    await this.prisma.aiRequest.create({ data: { userId, kind, prompt, response } });
    return { response };
  }
}
