import { LlmError } from '../llm.types';
import { OllamaAdapter } from './ollama.adapter';

function ndjsonResponse(lines: unknown[], status = 200): Response {
  const encoder = new TextEncoder();
  const text = lines.map((line) => JSON.stringify(line)).join('\n') + '\n';
  // Split mid-line so the reader has to buffer across chunks.
  const chunks = [text.slice(0, 7), text.slice(7, 40), text.slice(40)];
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { 'content-type': 'application/x-ndjson' } });
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status });
}

function adapter(fetchFn: jest.Mock, overrides: { retries?: number; timeoutMs?: number } = {}) {
  return new OllamaAdapter({
    baseUrl: 'http://ollama.test',
    apiKey: 'test-key',
    timeoutMs: overrides.timeoutMs ?? 5_000,
    retry: { retries: overrides.retries ?? 2, baseDelayMs: 1 },
    fetchFn: fetchFn as unknown as typeof fetch,
  });
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) {
    out.push(item);
  }
  return out;
}

describe('OllamaAdapter', () => {
  it('streams deltas and finishes with content, usage and the answering model', async () => {
    const fetchFn = jest.fn().mockResolvedValue(
      ndjsonResponse([
        { model: 'gpt-oss:20b', message: { content: '{"a":' } },
        { model: 'gpt-oss:20b', message: { content: '1}' } },
        {
          model: 'gpt-oss:20b',
          message: { content: '' },
          done: true,
          done_reason: 'stop',
          prompt_eval_count: 12,
          eval_count: 5,
        },
      ]),
    );

    const events = await collect(
      adapter(fetchFn).stream({
        model: 'gpt-oss:20b',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    );

    expect(events.filter((event) => event.type === 'delta')).toEqual([
      { type: 'delta', text: '{"a":' },
      { type: 'delta', text: '1}' },
    ]);
    expect(events.at(-1)).toEqual({
      type: 'done',
      result: {
        content: '{"a":1}',
        toolCalls: [],
        finishReason: 'stop',
        usage: { inputTokens: 12, outputTokens: 5 },
        model: 'gpt-oss:20b',
      },
    });
  });

  it('sends the schema as `format`, tools in function form, options and the bearer key', async () => {
    const fetchFn = jest.fn().mockResolvedValue(ndjsonResponse([{ done: true, message: {} }]));
    const schema = { type: 'object', properties: { a: { type: 'string' } } };

    await adapter(fetchFn).chat({
      model: 'm',
      messages: [
        { role: 'system', content: 's' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'call_0', name: 'look', arguments: { q: 1 } }],
        },
        { role: 'tool', content: '{"ok":true}', toolCallId: 'call_0', toolName: 'look' },
      ],
      responseSchema: schema,
      tools: [{ name: 'look', description: 'Look', parameters: { type: 'object' } }],
      temperature: 0.2,
      contextTokens: 4096,
      maxOutputTokens: 300,
    });

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://ollama.test/api/chat');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer test-key');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'm',
      stream: true,
      format: schema,
      tools: [{ type: 'function', function: { name: 'look', description: 'Look' } }],
      options: { temperature: 0.2, num_ctx: 4096, num_predict: 300 },
    });
    expect(body.messages).toEqual([
      { role: 'system', content: 's' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ function: { name: 'look', arguments: { q: 1 } } }],
      },
      { role: 'tool', content: '{"ok":true}', tool_name: 'look' },
    ]);
  });

  it('assigns ids to tool calls and reports finishReason tool_calls', async () => {
    const fetchFn = jest.fn().mockResolvedValue(
      ndjsonResponse([
        {
          message: {
            content: '',
            tool_calls: [
              { function: { name: 'a', arguments: { x: 1 } } },
              { function: { name: 'b', arguments: '{"y":2}' } },
            ],
          },
        },
        { done: true, done_reason: 'stop', message: {} },
      ]),
    );

    const result = await adapter(fetchFn).chat({ model: 'm', messages: [] });

    expect(result.finishReason).toBe('tool_calls');
    expect(result.toolCalls).toEqual([
      { id: 'call_0', name: 'a', arguments: { x: 1 } },
      { id: 'call_1', name: 'b', arguments: { y: 2 } },
    ]);
  });

  it('maps 402 to a non-retryable BILLING error and does not retry it', async () => {
    const fetchFn = jest.fn().mockResolvedValue(jsonResponse({ error: 'Add usage credits' }, 402));

    await expect(adapter(fetchFn).chat({ model: 'm', messages: [] })).rejects.toMatchObject({
      code: 'BILLING',
      retryable: false,
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('retries transient failures a bounded number of times', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'busy' }, 503))
      .mockResolvedValueOnce(jsonResponse({ error: 'slow down' }, 429))
      .mockResolvedValueOnce(ndjsonResponse([{ done: true, message: { content: 'ok' } }]));

    const result = await adapter(fetchFn).chat({ model: 'm', messages: [] });

    expect(result.content).toBe('ok');
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('gives up after the retry budget', async () => {
    const fetchFn = jest.fn().mockResolvedValue(jsonResponse({ error: 'down' }, 500));

    await expect(
      adapter(fetchFn, { retries: 1 }).chat({ model: 'm', messages: [] }),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('reports a timeout when the provider does not answer in time', async () => {
    const fetchFn = jest.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          );
        }),
    );

    await expect(
      adapter(fetchFn, { retries: 0, timeoutMs: 20 }).chat({ model: 'm', messages: [] }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('reports cancellation when the caller aborts', async () => {
    const fetchFn = jest.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          );
        }),
    );
    const controller = new AbortController();
    const pending = adapter(fetchFn, { retries: 0 }).chat({
      model: 'm',
      messages: [],
      signal: controller.signal,
    });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('turns an error line inside the stream into an LlmError', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValue(
        ndjsonResponse([{ message: { content: 'x' } }, { error: 'model crashed' }]),
      );

    await expect(
      adapter(fetchFn, { retries: 0 }).chat({ model: 'm', messages: [] }),
    ).rejects.toBeInstanceOf(LlmError);
  });

  it('lists models with their family and size', async () => {
    const fetchFn = jest.fn().mockResolvedValue(
      jsonResponse(
        {
          models: [{ name: 'llama3.2:1b', details: { family: 'llama', parameter_size: '1.2B' } }],
        },
        200,
      ),
    );

    await expect(adapter(fetchFn).listModels()).resolves.toEqual([
      { name: 'llama3.2:1b', details: 'llama 1.2B' },
    ]);
  });

  it('returns embeddings from /api/embed', async () => {
    const fetchFn = jest.fn().mockResolvedValue(jsonResponse({ embeddings: [[1, 2]] }, 200));

    await expect(adapter(fetchFn).embed({ model: 'e', input: ['a'] })).resolves.toEqual([[1, 2]]);
    expect(fetchFn.mock.calls[0][0]).toBe('http://ollama.test/api/embed');
  });
});

describe('OllamaAdapter stalled stream', () => {
  it('times out a reply that stops arriving mid-stream', async () => {
    const encoder = new TextEncoder();
    const fetchFn = jest.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                encoder.encode(JSON.stringify({ message: { content: '{' } }) + '\n'),
              );
            },
          }),
          { status: 200 },
        ),
      ),
    );
    const startedAt = Date.now();

    await expect(
      adapter(fetchFn, { retries: 0, timeoutMs: 50 }).chat({ model: 'm', messages: [] }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });
});
