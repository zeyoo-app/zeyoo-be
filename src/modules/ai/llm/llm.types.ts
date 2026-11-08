/**
 * The provider-neutral contract every LLM adapter implements. Feature code depends
 * only on these types; vendor SDKs and wire formats stay inside `adapters/`.
 */

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Tool calls the assistant asked for (assistant messages only). */
  toolCalls?: ToolCall[];
  /** Which call this message answers (tool messages only). */
  toolCallId?: string;
  /** The tool's name (tool messages only); some providers need it. */
  toolName?: string;
}

/** A function the model may call. `parameters` is a JSON Schema object. */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  /** When set, the reply must be JSON matching this JSON Schema object. */
  responseSchema?: Record<string, unknown>;
  temperature?: number;
  maxOutputTokens?: number;
  /** Size of the context window to reserve, for providers that let callers set it. */
  contextTokens?: number;
  signal?: AbortSignal;
}

export interface TokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
}

export type FinishReason = 'stop' | 'length' | 'tool_calls' | 'refusal' | 'other';

export interface ChatResult {
  content: string;
  toolCalls: ToolCall[];
  finishReason: FinishReason;
  usage: TokenUsage;
  /** The model that actually answered (may differ when a provider falls back). */
  model: string;
}

/** One piece of a streamed reply. The last event is always `done`. */
export type ChatStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'done'; result: ChatResult };

export interface ModelInfo {
  name: string;
  /** Approximate size or family, when the provider reports it. */
  details?: string;
}

export interface EmbedRequest {
  model: string;
  input: string[];
  signal?: AbortSignal;
}

export type LlmProviderId = 'ollama' | 'anthropic';

export interface LlmProvider {
  readonly id: LlmProviderId;
  /** True when the adapter has what it needs (base URL, key) to make calls. */
  isConfigured(): boolean;
  chat(request: ChatRequest): Promise<ChatResult>;
  stream(request: ChatRequest): AsyncIterable<ChatStreamEvent>;
  embed(request: EmbedRequest): Promise<number[][]>;
  listModels(signal?: AbortSignal): Promise<ModelInfo[]>;
}

export type LlmErrorCode =
  | 'NOT_CONFIGURED'
  | 'AUTH'
  | 'BILLING'
  | 'RATE_LIMITED'
  | 'MODEL_NOT_FOUND'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'UNAVAILABLE'
  | 'BAD_REQUEST'
  | 'REFUSED'
  | 'UNSUPPORTED';

/** Every adapter failure arrives as this, so callers never see vendor error types. */
export class LlmError extends Error {
  constructor(
    readonly code: LlmErrorCode,
    message: string,
    /** Whether the same request may succeed if sent again. */
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}
