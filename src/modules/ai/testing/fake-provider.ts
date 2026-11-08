import {
  ChatRequest,
  ChatResult,
  ChatStreamEvent,
  LlmProvider,
  LlmProviderId,
  ModelInfo,
  ToolCall,
} from '../llm/llm.types';

/** One scripted model reply: text streamed in chunks, optional tool calls, or a thrown error. */
export interface ScriptedReply {
  text?: string;
  toolCalls?: ToolCall[];
  finishReason?: ChatResult['finishReason'];
  error?: Error;
}

/**
 * A provider that plays back scripted replies, for tests. Records every request so
 * tests can assert on the messages the agent sent.
 */
export class FakeProvider implements LlmProvider {
  readonly requests: ChatRequest[] = [];
  private readonly replies: ScriptedReply[];

  constructor(
    replies: ScriptedReply[],
    readonly id: LlmProviderId = 'ollama',
    private readonly models: ModelInfo[] = [{ name: 'fake-model' }],
  ) {
    this.replies = [...replies];
  }

  isConfigured(): boolean {
    return true;
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    let result: ChatResult | undefined;
    for await (const event of this.stream(request)) {
      if (event.type === 'done') {
        result = event.result;
      }
    }
    return result as ChatResult;
  }

  async *stream(request: ChatRequest): AsyncIterable<ChatStreamEvent> {
    this.requests.push({ ...request, messages: [...request.messages] });
    const reply = this.replies.shift() ?? { text: '{}' };
    if (reply.error) {
      throw reply.error;
    }
    const text = reply.text ?? '';
    // Stream in a few pieces so partial-result handling is exercised.
    const size = Math.max(1, Math.ceil(text.length / 4));
    for (let index = 0; index < text.length; index += size) {
      if (request.signal?.aborted) {
        throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      }
      yield { type: 'delta', text: text.slice(index, index + size) };
    }
    for (const call of reply.toolCalls ?? []) {
      yield { type: 'tool_call', call };
    }
    yield {
      type: 'done',
      result: {
        content: text,
        toolCalls: reply.toolCalls ?? [],
        finishReason: reply.finishReason ?? (reply.toolCalls?.length ? 'tool_calls' : 'stop'),
        usage: { inputTokens: 10, outputTokens: 20 },
        model: request.model,
      },
    };
  }

  embed(): Promise<number[][]> {
    return Promise.resolve([[0.1, 0.2]]);
  }

  listModels(): Promise<ModelInfo[]> {
    return Promise.resolve(this.models);
  }
}
