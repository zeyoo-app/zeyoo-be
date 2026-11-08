import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Campaign } from '@prisma/client';
import { CampaignService } from '@modules/campaigns/campaigns.public';
import { CreatorProfileService } from '@modules/creators/creators.public';
import { PrismaService } from '@platform/database/prisma.service';
import { AgentEvent, AgentRunner } from '../agent/agent-runner';
import { clip, CONTEXT_BUILDER, ContextBuilder } from '../context/context-builder';
import { CampaignBriefDto, ContentIdeasDto } from '../dto/ai.dto';
import { LLM_CONFIG, LlmConfig } from '../llm/llm-config';
import { LlmError } from '../llm/llm.types';
import { LLM_PROVIDERS, ProviderRegistry } from '../llm/provider-registry';
import { CampaignBriefDraft, campaignBriefV1 } from '../prompts/campaign-brief.v1';
import { ContentIdeas, ContentIdeasContext, contentIdeasV1 } from '../prompts/content-ideas.v1';
import { jsonSchemaOf, PromptTemplate, templateKey } from '../prompts/prompt-template';
import { describeAiFailure } from './ai-errors';
import { AiSettingsService } from './ai-settings.service';

export interface AiResultMeta {
  provider: string;
  model: string;
  promptVersion: string;
  durationMs: number;
}

export interface AiResult<T> {
  data: T;
  meta: AiResultMeta;
}

export interface RunOptions {
  signal: AbortSignal;
  onEvent?: (event: AgentEvent) => void;
}

// Retrieved fields are clipped before they reach the prompt, so one long campaign
// cannot crowd out the instructions.
const LIMITS = { brief: 2000, guidelines: 1200, goals: 400, audience: 300, bio: 300 };

/**
 * The AI features. Each one gathers the minimal context it needs, hands it to the
 * agent runner through a versioned template, and logs the outcome.
 */
@Injectable()
export class AiAssistantService {
  private readonly logger = new Logger(AiAssistantService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AiSettingsService,
    private readonly campaigns: CampaignService,
    private readonly creators: CreatorProfileService,
    private readonly runner: AgentRunner,
    @Inject(CONTEXT_BUILDER) private readonly context: ContextBuilder,
    @Inject(LLM_PROVIDERS) private readonly registry: ProviderRegistry,
    @Inject(LLM_CONFIG) private readonly config: LlmConfig,
  ) {}

  draftCampaignBrief(
    userId: string,
    dto: CampaignBriefDto,
    options: RunOptions,
  ): Promise<AiResult<CampaignBriefDraft>> {
    return this.brandNameOf(userId).then((brandName) =>
      this.executeBrief(userId, dto, brandName, options),
    );
  }

  private executeBrief(
    userId: string,
    dto: CampaignBriefDto,
    brandName: string | undefined,
    options: RunOptions,
  ): Promise<AiResult<CampaignBriefDraft>> {
    return this.execute(
      userId,
      campaignBriefV1,
      {
        brandName,
        idea: dto.idea,
        goal: dto.goal || undefined,
        title: dto.title || undefined,
        platforms: dto.platforms,
        contentType: dto.contentType,
        language: dto.language,
      },
      options,
    ).then((result) => ({ ...result, data: normalizeBrief(result.data) }));
  }

  /**
   * The name of the brand the user works for, so a draft names the brand rather than
   * the marketplace. The first membership matches the organization the apps act for.
   */
  private async brandNameOf(userId: string): Promise<string | undefined> {
    const membership = await this.prisma.membership.findFirst({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { organization: { select: { name: true } } },
    });
    return membership?.organization.name;
  }

  /**
   * Gathers what the content-ideas prompt needs. Separate from generation so access
   * errors (403/404) surface as plain HTTP errors before a stream is opened.
   */
  async prepareContentIdeas(userId: string, dto: ContentIdeasDto): Promise<ContentIdeasContext> {
    // Throws 403 when the creator cannot see this campaign.
    const campaign = (await this.campaigns.getById(dto.campaignId, userId)) as Campaign;
    const creator = await this.creators.getPublicByUserId(userId).catch((error: unknown) => {
      if (error instanceof NotFoundException) {
        return undefined;
      }
      throw error;
    });
    return {
      campaign: {
        title: campaign.title,
        brief: clip(campaign.description, LIMITS.brief),
        goals: clip(campaign.goals, LIMITS.goals) || null,
        audience: clip(campaign.audience, LIMITS.audience) || null,
        guidelines: clip(campaign.guidelines, LIMITS.guidelines) || null,
        hashtags: campaign.hashtags,
        platforms: campaign.platforms.length ? campaign.platforms : [campaign.platform],
        contentType: campaign.contentType,
      },
      creator: creator
        ? {
            displayName: creator.displayName,
            headline: creator.headline,
            bio: clip(creator.bio, LIMITS.bio) || null,
          }
        : undefined,
      focus: dto.focus || undefined,
      language: dto.language,
    };
  }

  suggestContentIdeas(
    userId: string,
    context: ContentIdeasContext,
    options: RunOptions,
  ): Promise<AiResult<ContentIdeas>> {
    return this.execute(userId, contentIdeasV1, context, options);
  }

  private async execute<TContext, TOutput>(
    userId: string,
    template: PromptTemplate<TContext, TOutput>,
    context: TContext,
    options: RunOptions,
  ): Promise<AiResult<TOutput>> {
    const startedAt = Date.now();
    const promptVersion = templateKey(template);
    const active = await this.settings.active();
    const messages = this.context.start(template, context);
    // The caller can cancel; the deadline caps the whole run, retries and repairs included.
    const deadline = AbortSignal.timeout(this.config.runTimeoutMs);
    const signal = AbortSignal.any([options.signal, deadline]);
    const promptText = messages.find((message) => message.role === 'user')?.content ?? '';

    try {
      const provider = this.registry.get(active.provider);
      const run = await this.runner.run({
        provider,
        model: active.model,
        messages,
        output: template.output,
        outputSchema: jsonSchemaOf(template as PromptTemplate<unknown, unknown>),
        temperature: template.temperature,
        maxOutputTokens: this.config.maxOutputTokens,
        contextTokens: this.config.contextTokens,
        signal,
        onEvent: options.onEvent,
      });
      const durationMs = Date.now() - startedAt;
      await this.log({
        userId,
        kind: template.id,
        promptVersion,
        provider: active.provider,
        model: run.model,
        prompt: promptText,
        response: JSON.stringify(run.data),
        status: 'SUCCEEDED',
        inputTokens: run.usage.inputTokens,
        outputTokens: run.usage.outputTokens,
        durationMs,
      });
      return {
        data: run.data,
        meta: { provider: active.provider, model: run.model, promptVersion, durationMs },
      };
    } catch (caught) {
      const error =
        deadline.aborted && !options.signal.aborted
          ? new LlmError('TIMEOUT', 'The assistant run exceeded its deadline.', true)
          : caught;
      const failure = describeAiFailure(error);
      const cancelled = options.signal.aborted;
      if (!cancelled) {
        // The provider's own message helps staff; it never contains a credential.
        this.logger.warn(
          `${promptVersion} via ${active.provider}/${active.model} failed: ${failure.code} ${(error as Error).message}`,
        );
      }
      await this.log({
        userId,
        kind: template.id,
        promptVersion,
        provider: active.provider,
        model: active.model,
        prompt: promptText,
        response: null,
        status: cancelled ? 'CANCELLED' : 'FAILED',
        errorCode: failure.code,
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }
  }

  private async log(entry: {
    userId: string;
    kind: string;
    promptVersion: string;
    provider: string;
    model: string;
    prompt: string;
    response: string | null;
    status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
    errorCode?: string;
    inputTokens?: number | null;
    outputTokens?: number | null;
    durationMs: number;
  }): Promise<void> {
    // Logging must never fail the user's request.
    await this.prisma.aiRequest.create({ data: entry }).catch((error: unknown) => {
      this.logger.error(`Could not log AI request: ${(error as Error).message}`);
    });
  }
}

/** Hashtags arrive with or without '#', sometimes with spaces; store them one way. */
function normalizeBrief(draft: CampaignBriefDraft): CampaignBriefDraft {
  const hashtags = [
    ...new Set(
      draft.hashtags
        .map((tag) => `#${tag.trim().replace(/^#+/, '').replace(/\s+/g, '_')}`)
        .filter((tag) => tag.length > 1),
    ),
  ];
  return { ...draft, hashtags };
}
