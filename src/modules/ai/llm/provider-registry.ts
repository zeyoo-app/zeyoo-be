import { AnthropicAdapter } from './adapters/anthropic.adapter';
import { OllamaAdapter } from './adapters/ollama.adapter';
import { LlmConfig } from './llm-config';
import { LlmError, LlmProvider, LlmProviderId } from './llm.types';

export const LLM_PROVIDERS = 'LlmProviders';

/** The configured adapters, keyed by id. Adding a provider means one adapter + one line here. */
export class ProviderRegistry {
  private readonly providers: Map<LlmProviderId, LlmProvider>;

  constructor(providers: LlmProvider[]) {
    this.providers = new Map(providers.map((provider) => [provider.id, provider]));
  }

  static fromConfig(config: LlmConfig): ProviderRegistry {
    const retry = { retries: config.maxRetries, baseDelayMs: 500 };
    return new ProviderRegistry([
      new OllamaAdapter({
        baseUrl: config.ollama.baseUrl,
        apiKey: config.ollama.apiKey,
        timeoutMs: config.requestTimeoutMs,
        retry,
      }),
      new AnthropicAdapter({
        apiKey: config.anthropic.apiKey,
        timeoutMs: config.requestTimeoutMs,
        maxRetries: config.maxRetries,
      }),
    ]);
  }

  get(id: LlmProviderId): LlmProvider {
    const provider = this.providers.get(id);
    if (!provider || !provider.isConfigured()) {
      throw new LlmError('NOT_CONFIGURED', `The ${id} AI provider is not configured.`);
    }
    return provider;
  }

  all(): LlmProvider[] {
    return [...this.providers.values()];
  }
}
