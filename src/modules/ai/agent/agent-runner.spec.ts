import { z } from 'zod';
import { ContextBuilder } from '../context/context-builder';
import { LlmError } from '../llm/llm.types';
import { FakeProvider } from '../testing/fake-provider';
import { AgentEvent, AgentOutputError, AgentRunner, AgentTool } from './agent-runner';

const output = z.object({ title: z.string().min(3), tags: z.array(z.string()).min(1) }).strict();

function runner(limits = { maxSteps: 6, maxRepairs: 2, partialIntervalMs: 0 }) {
  return new AgentRunner(
    new ContextBuilder({ contextTokens: 8000, reserveOutputTokens: 500 }),
    limits,
  );
}

function input(provider: FakeProvider, extra: Partial<Parameters<AgentRunner['run']>[0]> = {}) {
  return {
    provider,
    model: 'fake-model',
    messages: [
      { role: 'system' as const, content: 'sys' },
      { role: 'user' as const, content: 'task' },
    ],
    output,
    outputSchema: { type: 'object' },
    temperature: 0.3,
    maxOutputTokens: 500,
    contextTokens: 8000,
    signal: new AbortController().signal,
    ...extra,
  };
}

describe('AgentRunner', () => {
  it('returns a validated result and reports progress and partial data', async () => {
    const provider = new FakeProvider([{ text: '{"title":"Glow up","tags":["#glow"]}' }]);
    const events: AgentEvent[] = [];

    const result = await runner().run(input(provider, { onEvent: (event) => events.push(event) }));

    expect(result.data).toEqual({ title: 'Glow up', tags: ['#glow'] });
    expect(result.steps).toBe(1);
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 20 });
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(['status', 'partial']),
    );
    expect(events.filter((event) => event.type === 'status').map((event) => event.stage)).toEqual([
      'thinking',
      'writing',
      'checking',
    ]);
    expect(provider.requests[0]).toMatchObject({
      model: 'fake-model',
      responseSchema: { type: 'object' },
      temperature: 0.3,
    });
  });

  it('sends an invalid reply back with the problems, then accepts the fix', async () => {
    const provider = new FakeProvider([
      { text: '{"title":"Hi","tags":[]}' },
      { text: '{"title":"Hello","tags":["#a"]}' },
    ]);

    const result = await runner().run(input(provider));

    expect((result.data as { title: string }).title).toBe('Hello');
    expect(result.steps).toBe(2);
    const repair = provider.requests[1].messages.at(-1);
    expect(repair?.role).toBe('user');
    expect(repair?.content).toContain('title');
    expect(repair?.content).toContain('tags');
    expect(provider.requests[1].messages.at(-2)).toEqual({
      role: 'assistant',
      content: '{"title":"Hi","tags":[]}',
    });
  });

  it('accepts JSON wrapped in a code fence', async () => {
    const provider = new FakeProvider([{ text: '```json\n{"title":"Fenced","tags":["#x"]}\n```' }]);

    await expect(runner().run(input(provider))).resolves.toMatchObject({
      data: { title: 'Fenced' },
    });
  });

  it('gives up after the repair budget', async () => {
    const provider = new FakeProvider([{ text: 'nope' }, { text: 'still no' }, { text: '{}' }]);

    await expect(
      runner({ maxSteps: 6, maxRepairs: 1, partialIntervalMs: 0 }).run(input(provider)),
    ).rejects.toBeInstanceOf(AgentOutputError);
    expect(provider.requests).toHaveLength(2);
  });

  it('asks again with more room when a reply is cut off by the token limit', async () => {
    const provider = new FakeProvider([
      { text: '{"title":"Lo', finishReason: 'length' },
      { text: '{"title":"Long enough","tags":["#a"]}' },
    ]);

    const result = await runner().run(input(provider));

    expect(result.data).toEqual({ title: 'Long enough', tags: ['#a'] });
    expect(provider.requests.map((request) => request.maxOutputTokens)).toEqual([500, 1000]);
    // The cut-off text is not sent back to the model.
    expect(provider.requests[1].messages).toHaveLength(2);
  });

  it('fails once the output budget has grown as far as it may', async () => {
    const cutOff = { text: '{"title":"Lo', finishReason: 'length' as const };
    const provider = new FakeProvider([cutOff, cutOff, cutOff, cutOff]);

    await expect(runner().run(input(provider))).rejects.toThrow('cut off');
    expect(provider.requests.map((request) => request.maxOutputTokens)).toEqual([500, 1000, 2000]);
  });

  it('tidies small slips instead of failing: extra fields, long text, too many items', async () => {
    const strict = z
      .object({ title: z.string().min(3).max(12), tags: z.array(z.string().min(2)).min(1).max(2) })
      .strict();
    const provider = new FakeProvider([
      { text: '{"title":"  A rather long title here ","tags":["#a1","x","#b2","#c3"],"extra":1}' },
    ]);

    const result = await runner().run(input(provider, { output: strict }));

    expect(result.data).toEqual({ title: 'A rather', tags: ['#a1', '#b2'] });
    expect(provider.requests).toHaveLength(1);
  });

  it('runs requested tools with validated arguments and feeds results back', async () => {
    const lookup: AgentTool<{ id: string }> = {
      spec: {
        name: 'get_campaign',
        description: 'Read a campaign',
        parameters: { type: 'object' },
      },
      args: z.object({ id: z.string() }),
      label: 'Reading the campaign',
      run: jest.fn().mockResolvedValue({ title: 'Summer' }),
    };
    const provider = new FakeProvider([
      {
        toolCalls: [
          { id: 'call_0', name: 'get_campaign', arguments: { id: 'c1' } },
          { id: 'call_1', name: 'get_campaign', arguments: { id: 5 } },
          { id: 'call_2', name: 'missing_tool', arguments: {} },
        ],
      },
      { text: '{"title":"Summer ideas","tags":["#summer"]}' },
    ]);
    const events: AgentEvent[] = [];

    const result = await runner().run(
      input(provider, { tools: [lookup as AgentTool], onEvent: (event) => events.push(event) }),
    );

    expect((result.data as { title: string }).title).toBe('Summer ideas');
    expect(lookup.run).toHaveBeenCalledTimes(1);
    expect(lookup.run).toHaveBeenCalledWith({ id: 'c1' }, expect.any(AbortSignal));
    const toolMessages = provider.requests[1].messages.filter((message) => message.role === 'tool');
    expect(toolMessages).toHaveLength(3);
    expect(toolMessages[0]).toMatchObject({ toolCallId: 'call_0', content: '{"title":"Summer"}' });
    expect(toolMessages[1].content).toContain('Invalid arguments');
    expect(toolMessages[2].content).toContain('Unknown tool');
    expect(events).toContainEqual({
      type: 'tool_call',
      id: 'call_0',
      name: 'get_campaign',
      label: 'Reading the campaign',
    });
    expect(events).toContainEqual({
      type: 'tool_result',
      id: 'call_1',
      name: 'get_campaign',
      ok: false,
    });
    expect(provider.requests[0].tools?.[0].name).toBe('get_campaign');
  });

  it('stops a tool loop at the step limit', async () => {
    const tool: AgentTool = {
      spec: { name: 'ping', description: 'ping', parameters: { type: 'object' } },
      args: z.object({}),
      label: 'Pinging',
      run: () => Promise.resolve('pong'),
    };
    const loop = Array.from({ length: 5 }, () => ({
      toolCalls: [{ id: 'call_0', name: 'ping', arguments: {} }],
    }));

    await expect(
      runner({ maxSteps: 3, maxRepairs: 1, partialIntervalMs: 0 }).run(
        input(new FakeProvider(loop), { tools: [tool] }),
      ),
    ).rejects.toThrow('too many steps');
  });

  it('does not call the model once cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = new FakeProvider([{ text: '{}' }]);

    await expect(runner().run(input(provider, { signal: controller.signal }))).rejects.toEqual(
      new LlmError('CANCELLED', 'The request was cancelled.'),
    );
    expect(provider.requests).toHaveLength(0);
  });

  it('passes provider errors through unchanged', async () => {
    const provider = new FakeProvider([{ error: new LlmError('BILLING', 'no credits') }]);

    await expect(runner().run(input(provider))).rejects.toMatchObject({ code: 'BILLING' });
  });
});
