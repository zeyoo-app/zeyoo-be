import Anthropic from '@anthropic-ai/sdk';
import { errorForStatus } from '../http';
import {
  ChatMessage,
  ChatRequest,
  ChatResult,
  ChatStreamEvent,
  FinishReason,
  LlmError,
  LlmProvider,
  ModelInfo,
  ToolCall,
} from '../llm.types';

export interface AnthropicAdapterOptions {
  apiKey?: string;
  timeoutMs: number;
  maxRetries: number;
  /** Injected in tests; built from the key otherwise. */
  client?: Anthropic;
}

// Structured outputs accept a subset of JSON Schema; these keywords are enforced by
// the caller's own validation instead of being sent.
const UNSUPPORTED_SCHEMA_KEYWORDS = new Set([
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'pattern',
  'format',
]);

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/**
 * Claude through the official SDK. The SDK owns retries and timeouts here; this
 * adapter maps the neutral request onto the Messages API and its errors back.
 */
export class AnthropicAdapter implements LlmProvider {
  readonly id = 'anthropic' as const;
  private readonly client: Anthropic | null;

  constructor(options: AnthropicAdapterOptions) {
    this.client =
      options.client ??
      (options.apiKey
        ? new Anthropic({
            apiKey: options.apiKey,
            timeout: options.timeoutMs,
            maxRetries: options.maxRetries,
          })
        : null);
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    let result: ChatResult | undefined;
    for await (const event of this.stream(request)) {
      if (event.type === 'done') {
        result = event.result;
      }
    }
    if (!result) {
      throw new LlmError('UNAVAILABLE', 'The AI provider ended the reply early.', true);
    }
    return result;
  }

  async *stream(request: ChatRequest): AsyncIterable<ChatStreamEvent> {
    const client = this.requireClient();
    try {
      const stream = client.beta.messages.stream(
        {
          model: request.model,
          max_tokens: request.maxOutputTokens ?? 4096,
          ...this.toAnthropicMessages(request.messages),
          ...(request.tools?.length
            ? {
                tools: request.tools.map((tool) => ({
                  name: tool.name,
                  description: tool.description,
                  input_schema: tool.parameters as Anthropic.Beta.BetaTool.InputSchema,
                })),
              }
            : {}),
          ...(request.responseSchema
            ? {
                output_config: {
                  format: { type: 'json_schema', schema: sanitizeSchema(request.responseSchema) },
                },
              }
            : {}),
          betas: [FALLBACK_BETA],
          fallbacks: 'default',
        },
        { signal: request.signal },
      );

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield { type: 'delta', text: event.delta.text };
        }
      }

      const message = await stream.finalMessage();
      const toolCalls: ToolCall[] = [];
      let content = '';
      for (const block of message.content) {
        if (block.type === 'text') {
          content += block.text;
        } else if (block.type === 'tool_use') {
          const call: ToolCall = {
            id: block.id,
            name: block.name,
            arguments: (block.input ?? {}) as Record<string, unknown>,
          };
          toolCalls.push(call);
          yield { type: 'tool_call', call };
        }
      }
      if (message.stop_reason === 'refusal') {
        throw new LlmError('REFUSED', 'The AI model declined this request.');
      }
      yield {
        type: 'done',
        result: {
          content,
          toolCalls,
          finishReason: this.finishReason(message.stop_reason),
          usage: {
            inputTokens: message.usage.input_tokens ?? null,
            outputTokens: message.usage.output_tokens ?? null,
          },
          model: message.model,
        },
      };
    } catch (error) {
      throw this.toLlmError(error);
    }
  }

  embed(): Promise<number[][]> {
    return Promise.reject(
      new LlmError('UNSUPPORTED', 'This provider does not offer embeddings; use another one.'),
    );
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const client = this.requireClient();
    try {
      const models: ModelInfo[] = [];
      for await (const model of client.models.list({}, { signal })) {
        models.push({ name: model.id, details: model.display_name });
      }
      return models;
    } catch (error) {
      throw this.toLlmError(error);
    }
  }

  private requireClient(): Anthropic {
    if (!this.client) {
      throw new LlmError('NOT_CONFIGURED', 'ANTHROPIC_API_KEY is not set.');
    }
    return this.client;
  }

  /** System messages become the `system` field; tool traffic becomes content blocks. */
  private toAnthropicMessages(messages: ChatMessage[]): {
    system?: string;
    messages: Anthropic.Beta.BetaMessageParam[];
  } {
    const system = messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n');
    const turns: Anthropic.Beta.BetaMessageParam[] = [];
    for (const message of messages) {
      if (message.role === 'system') {
        continue;
      }
      if (message.role === 'tool') {
        turns.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: message.toolCallId ?? '',
              content: message.content,
            },
          ],
        });
      } else if (message.role === 'assistant' && message.toolCalls?.length) {
        turns.push({
          role: 'assistant',
          content: [
            ...(message.content ? [{ type: 'text' as const, text: message.content }] : []),
            ...message.toolCalls.map((call) => ({
              type: 'tool_use' as const,
              id: call.id,
              name: call.name,
              input: call.arguments,
            })),
          ],
        });
      } else {
        turns.push({ role: message.role, content: message.content });
      }
    }
    return { ...(system ? { system } : {}), messages: turns };
  }

  private finishReason(reason: string | null): FinishReason {
    switch (reason) {
      case 'end_turn':
      case 'stop_sequence':
        return 'stop';
      case 'max_tokens':
        return 'length';
      case 'tool_use':
        return 'tool_calls';
      case 'refusal':
        return 'refusal';
      default:
        return 'other';
    }
  }

  private toLlmError(error: unknown): LlmError {
    if (error instanceof LlmError) {
      return error;
    }
    if (error instanceof Anthropic.APIUserAbortError) {
      return new LlmError('CANCELLED', 'The request was cancelled.');
    }
    if (error instanceof Anthropic.APIConnectionTimeoutError) {
      return new LlmError('TIMEOUT', 'The AI provider took too long to answer.', true);
    }
    if (error instanceof Anthropic.APIConnectionError) {
      return new LlmError('UNAVAILABLE', 'Could not reach the AI provider.', true);
    }
    if (error instanceof Anthropic.APIError && typeof error.status === 'number') {
      return errorForStatus(error.status, '');
    }
    return new LlmError('UNAVAILABLE', 'The AI provider failed.', true);
  }
}

/** Drops keywords structured outputs reject and closes every object to extra keys. */
export function sanitizeSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const visit = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      return node.map(visit);
    }
    if (!node || typeof node !== 'object') {
      return node;
    }
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === 'properties' && value && typeof value === 'object') {
        // Property names are data, not keywords: keep every one.
        out[key] = Object.fromEntries(
          Object.entries(value as Record<string, unknown>).map(([name, sub]) => [name, visit(sub)]),
        );
      } else if (!UNSUPPORTED_SCHEMA_KEYWORDS.has(key)) {
        out[key] = visit(value);
      }
    }
    if (out.type === 'object') {
      out.additionalProperties = false;
    }
    return out;
  };
  return visit(schema) as Record<string, unknown>;
}
