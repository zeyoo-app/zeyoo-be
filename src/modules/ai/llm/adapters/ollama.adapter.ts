import {
  errorForStatus,
  errorForThrown,
  FetchFn,
  readNdjson,
  RetryPolicy,
  withRetry,
  withTimeout,
} from '../http';
import {
  ChatMessage,
  ChatRequest,
  ChatResult,
  ChatStreamEvent,
  EmbedRequest,
  FinishReason,
  LlmError,
  LlmProvider,
  ModelInfo,
  ToolCall,
} from '../llm.types';

export interface OllamaAdapterOptions {
  baseUrl: string;
  apiKey?: string;
  timeoutMs: number;
  retry: RetryPolicy;
  fetchFn?: FetchFn;
}

interface OllamaToolCall {
  function: { name: string; arguments: Record<string, unknown> | string };
}

interface OllamaChatChunk {
  model?: string;
  message?: { content?: string; tool_calls?: OllamaToolCall[] };
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

/**
 * Ollama's native API (`/api/chat`), for a local server or Ollama Cloud. Structured
 * output uses the `format` field with a JSON Schema; tools use Ollama's function
 * format, whose calls carry no ids, so ids are assigned here.
 */
export class OllamaAdapter implements LlmProvider {
  readonly id = 'ollama' as const;
  private readonly fetchFn: FetchFn;

  constructor(private readonly options: OllamaAdapterOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
  }

  isConfigured(): boolean {
    return Boolean(this.options.baseUrl);
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
    // Each attempt gets its own timeout, covering both the wait for headers and the
    // whole streamed reply.
    const { response, signal, timedOut } = await withRetry(
      async () => {
        const attempt = withTimeout(request.signal, this.options.timeoutMs);
        const res = await this.post(
          '/api/chat',
          this.chatBody(request),
          attempt.signal,
          attempt.timedOut,
        );
        return { response: res, ...attempt };
      },
      this.options.retry,
      request.signal,
    );
    if (!response.body) {
      throw new LlmError('UNAVAILABLE', 'The AI provider sent an empty reply.', true);
    }

    let content = '';
    const toolCalls: ToolCall[] = [];
    try {
      for await (const raw of readNdjson(response.body, signal)) {
        const chunk = raw as OllamaChatChunk;
        if (chunk.error) {
          throw new LlmError('UNAVAILABLE', `The AI provider failed: ${chunk.error}`, true);
        }
        const text = chunk.message?.content ?? '';
        if (text) {
          content += text;
          yield { type: 'delta', text };
        }
        for (const call of chunk.message?.tool_calls ?? []) {
          const toolCall = this.toToolCall(call, toolCalls.length);
          toolCalls.push(toolCall);
          yield { type: 'tool_call', call: toolCall };
        }
        if (chunk.done) {
          yield {
            type: 'done',
            result: {
              content,
              toolCalls,
              finishReason: this.finishReason(chunk.done_reason, toolCalls.length > 0),
              usage: {
                inputTokens: chunk.prompt_eval_count ?? null,
                outputTokens: chunk.eval_count ?? null,
              },
              model: chunk.model ?? request.model,
            },
          };
          return;
        }
      }
    } catch (error) {
      throw errorForThrown(error, timedOut());
    }
    throw new LlmError('UNAVAILABLE', 'The AI provider ended the reply early.', true);
  }

  async embed(request: EmbedRequest): Promise<number[][]> {
    const response = await withRetry(
      () => {
        const attempt = withTimeout(request.signal, this.options.timeoutMs);
        return this.post(
          '/api/embed',
          { model: request.model, input: request.input },
          attempt.signal,
          attempt.timedOut,
        );
      },
      this.options.retry,
      request.signal,
    );
    const body = (await response.json()) as { embeddings?: number[][] };
    if (!Array.isArray(body.embeddings)) {
      throw new LlmError('UNAVAILABLE', 'The AI provider returned no embeddings.');
    }
    return body.embeddings;
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const timed = withTimeout(signal, this.options.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchFn(`${this.options.baseUrl}/api/tags`, {
        headers: this.headers(),
        signal: timed.signal,
      });
    } catch (error) {
      throw errorForThrown(error, timed.timedOut());
    }
    if (!response.ok) {
      throw errorForStatus(response.status, await this.errorDetail(response));
    }
    const body = (await response.json()) as {
      models?: { name: string; details?: { parameter_size?: string; family?: string } }[];
    };
    return (body.models ?? []).map((model) => ({
      name: model.name,
      details: [model.details?.family, model.details?.parameter_size].filter(Boolean).join(' '),
    }));
  }

  private chatBody(request: ChatRequest): Record<string, unknown> {
    return {
      model: request.model,
      stream: true,
      messages: request.messages.map((message) => this.toOllamaMessage(message)),
      ...(request.responseSchema ? { format: request.responseSchema } : {}),
      ...(request.tools?.length
        ? {
            tools: request.tools.map((tool) => ({
              type: 'function',
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
              },
            })),
          }
        : {}),
      options: {
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        ...(request.contextTokens ? { num_ctx: request.contextTokens } : {}),
        ...(request.maxOutputTokens ? { num_predict: request.maxOutputTokens } : {}),
      },
    };
  }

  private toOllamaMessage(message: ChatMessage): Record<string, unknown> {
    if (message.role === 'tool') {
      return { role: 'tool', content: message.content, tool_name: message.toolName };
    }
    return {
      role: message.role,
      content: message.content,
      ...(message.toolCalls?.length
        ? {
            tool_calls: message.toolCalls.map((call) => ({
              function: { name: call.name, arguments: call.arguments },
            })),
          }
        : {}),
    };
  }

  private toToolCall(call: OllamaToolCall, index: number): ToolCall {
    const raw = call.function.arguments;
    let args: Record<string, unknown> = {};
    if (typeof raw === 'string') {
      try {
        args = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        args = {};
      }
    } else if (raw && typeof raw === 'object') {
      args = raw;
    }
    return { id: `call_${index}`, name: call.function.name, arguments: args };
  }

  private finishReason(reason: string | undefined, hasToolCalls: boolean): FinishReason {
    if (hasToolCalls) {
      return 'tool_calls';
    }
    if (reason === 'length') {
      return 'length';
    }
    return reason === 'stop' || reason === undefined ? 'stop' : 'other';
  }

  private async post(
    path: string,
    body: unknown,
    signal: AbortSignal,
    timedOut: () => boolean,
  ): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchFn(`${this.options.baseUrl}${path}`, {
        method: 'POST',
        headers: { ...this.headers(), 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      throw errorForThrown(error, timedOut());
    }
    if (!response.ok) {
      throw errorForStatus(response.status, await this.errorDetail(response));
    }
    return response;
  }

  private headers(): Record<string, string> {
    return this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {};
  }

  /** The provider's own error text, without anything that could echo a credential. */
  private async errorDetail(response: Response): Promise<string> {
    try {
      const body = (await response.json()) as { error?: unknown };
      return typeof body.error === 'string' ? body.error.slice(0, 200) : '';
    } catch {
      return '';
    }
  }
}
