import Anthropic from '@anthropic-ai/sdk';
import { AnthropicAdapter, sanitizeSchema } from './anthropic.adapter';

interface FakeFinal {
  content: unknown[];
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number };
  model: string;
}

function fakeClient(events: unknown[], final: FakeFinal) {
  const stream = jest.fn().mockImplementation(() => ({
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event;
      }
    },
    finalMessage: () => Promise.resolve(final),
  }));
  return { client: { beta: { messages: { stream } } } as unknown as Anthropic, stream };
}

describe('AnthropicAdapter', () => {
  it('maps system, tool traffic and the schema onto the Messages API', async () => {
    const { client, stream } = fakeClient(
      [{ type: 'content_block_delta', delta: { type: 'text_delta', text: '{"a":"b"}' } }],
      {
        content: [{ type: 'text', text: '{"a":"b"}' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 3, output_tokens: 4 },
        model: 'claude-opus-5-5',
      },
    );
    const adapter = new AnthropicAdapter({ client, timeoutMs: 1000, maxRetries: 0 });

    const result = await adapter.chat({
      model: 'claude-opus-5-5',
      messages: [
        { role: 'system', content: 'rules' },
        { role: 'user', content: 'task' },
        { role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'look', arguments: {} }] },
        { role: 'tool', content: '{"x":1}', toolCallId: 't1', toolName: 'look' },
      ],
      responseSchema: { type: 'object', properties: { a: { type: 'string', maxLength: 5 } } },
      maxOutputTokens: 500,
    });

    const params = stream.mock.calls[0][0] as Record<string, unknown>;
    expect(params.system).toBe('rules');
    expect(params.max_tokens).toBe(500);
    expect(params.messages).toEqual([
      { role: 'user', content: 'task' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'look', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{"x":1}' }] },
    ]);
    expect(params.output_config).toEqual({
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: { a: { type: 'string' } },
          additionalProperties: false,
        },
      },
    });
    expect(params.fallbacks).toBe('default');
    expect(result).toEqual({
      content: '{"a":"b"}',
      toolCalls: [],
      finishReason: 'stop',
      usage: { inputTokens: 3, outputTokens: 4 },
      model: 'claude-opus-5-5',
    });
  });

  it('surfaces tool_use blocks as tool calls', async () => {
    const { client } = fakeClient([], {
      content: [{ type: 'tool_use', id: 'tu_1', name: 'look', input: { q: 'x' } }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 1, output_tokens: 1 },
      model: 'm',
    });

    const result = await new AnthropicAdapter({ client, timeoutMs: 1, maxRetries: 0 }).chat({
      model: 'm',
      messages: [{ role: 'user', content: 'x' }],
    });

    expect(result.finishReason).toBe('tool_calls');
    expect(result.toolCalls).toEqual([{ id: 'tu_1', name: 'look', arguments: { q: 'x' } }]);
  });

  it('turns a refusal into a REFUSED error', async () => {
    const { client } = fakeClient([], {
      content: [],
      stop_reason: 'refusal',
      usage: { input_tokens: 1, output_tokens: 0 },
      model: 'm',
    });

    await expect(
      new AnthropicAdapter({ client, timeoutMs: 1, maxRetries: 0 }).chat({
        model: 'm',
        messages: [],
      }),
    ).rejects.toMatchObject({ code: 'REFUSED' });
  });

  it('is not configured without a key, and says so on use', async () => {
    const adapter = new AnthropicAdapter({ timeoutMs: 1, maxRetries: 0 });

    expect(adapter.isConfigured()).toBe(false);
    await expect(adapter.chat({ model: 'm', messages: [] })).rejects.toMatchObject({
      code: 'NOT_CONFIGURED',
    });
  });

  it('does not offer embeddings', async () => {
    const { client } = fakeClient([], {
      content: [],
      stop_reason: 'end_turn',
      usage: { input_tokens: 0, output_tokens: 0 },
      model: 'm',
    });

    await expect(
      new AnthropicAdapter({ client, timeoutMs: 1, maxRetries: 0 }).embed(),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED' });
  });
});

describe('sanitizeSchema', () => {
  it('drops unsupported keywords, keeps property names and closes objects', () => {
    expect(
      sanitizeSchema({
        type: 'object',
        properties: {
          format: { type: 'string', minLength: 2 },
          list: { type: 'array', maxItems: 3, items: { type: 'object', properties: {} } },
        },
        required: ['format'],
      }),
    ).toEqual({
      type: 'object',
      properties: {
        format: { type: 'string' },
        list: {
          type: 'array',
          items: { type: 'object', properties: {}, additionalProperties: false },
        },
      },
      required: ['format'],
      additionalProperties: false,
    });
  });
});
