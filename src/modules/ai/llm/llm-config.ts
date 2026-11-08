import { Env } from '@platform/config/env.schema';
import { LlmProviderId } from './llm.types';

/** Everything the AI layer reads from the environment, resolved once at boot. */
export interface LlmConfig {
  /** Provider used when no admin override is saved. */
  defaultProvider: LlmProviderId;
  requestTimeoutMs: number;
  /** Deadline for a whole assistant run, however many model calls it makes. */
  runTimeoutMs: number;
  /** Extra attempts on transient provider failures (429, 5xx, network). */
  maxRetries: number;
  /** Context window reserved per request, where the provider lets callers set it. */
  contextTokens: number;
  maxOutputTokens: number;
  ollama: { baseUrl: string; apiKey?: string; model: string };
  anthropic: { apiKey?: string; model: string };
}

export const LLM_CONFIG = 'LlmConfig';

export const LLM_ENV_KEYS = [
  'LLM_PROVIDER',
  'AI_REQUEST_TIMEOUT_MS',
  'AI_RUN_TIMEOUT_MS',
  'AI_MAX_RETRIES',
  'AI_CONTEXT_TOKENS',
  'AI_MAX_OUTPUT_TOKENS',
  'OLLAMA_BASE_URL',
  'OLLAMA_API_KEY',
  'OLLAMA_MODEL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
] as const satisfies readonly (keyof Env)[];

export type LlmEnv = Pick<Env, (typeof LLM_ENV_KEYS)[number]>;

export function llmConfigFromEnv(env: LlmEnv): LlmConfig {
  return {
    defaultProvider: env.LLM_PROVIDER,
    requestTimeoutMs: env.AI_REQUEST_TIMEOUT_MS,
    runTimeoutMs: env.AI_RUN_TIMEOUT_MS,
    maxRetries: env.AI_MAX_RETRIES,
    contextTokens: env.AI_CONTEXT_TOKENS,
    maxOutputTokens: env.AI_MAX_OUTPUT_TOKENS,
    ollama: {
      baseUrl: env.OLLAMA_BASE_URL.replace(/\/$/, ''),
      apiKey: env.OLLAMA_API_KEY || undefined,
      model: env.OLLAMA_MODEL,
    },
    anthropic: {
      apiKey: env.ANTHROPIC_API_KEY || undefined,
      model: env.ANTHROPIC_MODEL,
    },
  };
}
