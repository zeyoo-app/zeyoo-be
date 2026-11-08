import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '@platform/database/prisma.service';
import { LLM_CONFIG, LlmConfig } from '../llm/llm-config';
import { LlmError, LlmProviderId, ModelInfo } from '../llm/llm.types';
import { LLM_PROVIDERS, ProviderRegistry } from '../llm/provider-registry';

const SETTING_KEY = 'default';
const CACHE_MS = 15_000;

export interface ActiveModel {
  provider: LlmProviderId;
  model: string;
}

export interface ProviderStatus {
  id: LlmProviderId;
  configured: boolean;
  defaultModel: string;
}

export interface AiSettingsView {
  active: ActiveModel;
  /** Where the active choice comes from: saved by staff, or the environment. */
  source: 'admin' | 'environment';
  providers: ProviderStatus[];
}

/** Which provider and model the assistants use, with a staff override over the env default. */
@Injectable()
export class AiSettingsService {
  private cached: { value: ActiveModel; source: AiSettingsView['source']; at: number } | null =
    null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(LLM_CONFIG) private readonly config: LlmConfig,
    @Inject(LLM_PROVIDERS) private readonly registry: ProviderRegistry,
  ) {}

  async active(): Promise<ActiveModel> {
    return (await this.resolve()).value;
  }

  async view(): Promise<AiSettingsView> {
    const { value, source } = await this.resolve();
    return {
      active: value,
      source,
      providers: this.registry.all().map((provider) => ({
        id: provider.id,
        configured: provider.isConfigured(),
        defaultModel: this.defaultModelOf(provider.id),
      })),
    };
  }

  async models(provider: LlmProviderId): Promise<ModelInfo[]> {
    return this.registry.get(provider).listModels();
  }

  /** Saves the choice after checking the provider is set up and offers that model. */
  async update(provider: LlmProviderId, model: string, staffId: string): Promise<AiSettingsView> {
    let available: ModelInfo[];
    try {
      available = await this.models(provider);
    } catch (error) {
      if (error instanceof LlmError) {
        throw new BadRequestException(`Cannot use ${provider}: ${error.message}`);
      }
      throw error;
    }
    if (available.length > 0 && !available.some((entry) => entry.name === model)) {
      throw new BadRequestException(
        `The ${provider} provider does not offer the model "${model}".`,
      );
    }
    await this.prisma.aiSetting.upsert({
      where: { key: SETTING_KEY },
      create: { key: SETTING_KEY, provider, model, updatedByStaffId: staffId },
      update: { provider, model, updatedByStaffId: staffId },
    });
    this.cached = null;
    return this.view();
  }

  /** Drops the staff override so the environment's defaults apply again. */
  async reset(): Promise<AiSettingsView> {
    await this.prisma.aiSetting.deleteMany({ where: { key: SETTING_KEY } });
    this.cached = null;
    return this.view();
  }

  private async resolve(): Promise<{ value: ActiveModel; source: AiSettingsView['source'] }> {
    if (this.cached && Date.now() - this.cached.at < CACHE_MS) {
      return this.cached;
    }
    const saved = await this.prisma.aiSetting.findUnique({ where: { key: SETTING_KEY } });
    const resolved =
      saved && isProviderId(saved.provider)
        ? { value: { provider: saved.provider, model: saved.model }, source: 'admin' as const }
        : {
            value: {
              provider: this.config.defaultProvider,
              model: this.defaultModelOf(this.config.defaultProvider),
            },
            source: 'environment' as const,
          };
    this.cached = { ...resolved, at: Date.now() };
    return resolved;
  }

  private defaultModelOf(provider: LlmProviderId): string {
    return provider === 'ollama' ? this.config.ollama.model : this.config.anthropic.model;
  }
}

function isProviderId(value: string): value is LlmProviderId {
  return value === 'ollama' || value === 'anthropic';
}
