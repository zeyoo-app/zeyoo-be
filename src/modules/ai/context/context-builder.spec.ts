import { z } from 'zod';
import { ChatMessage } from '../llm/llm.types';
import { campaignBriefV1 } from '../prompts/campaign-brief.v1';
import { PromptTemplate } from '../prompts/prompt-template';
import { clip, ContextBuilder, estimateTokens } from './context-builder';

const template: PromptTemplate<{ topic: string }, unknown> = {
  id: 'test',
  version: 1,
  system: 'You are a test.',
  renderTask: ({ topic }) => `Topic: ${topic}`,
  output: z.unknown(),
  temperature: 0,
};

describe('clip', () => {
  it('leaves short text alone and trims whitespace', () => {
    expect(clip('  hello  ', 10)).toBe('hello');
    expect(clip(null, 10)).toBe('');
  });

  it('cuts long text at a word boundary and marks the cut', () => {
    expect(clip('one two three four five', 13)).toBe('one two three…');
  });
});

describe('ContextBuilder', () => {
  it('starts with the template system prompt and the rendered task', () => {
    const builder = new ContextBuilder({ contextTokens: 1000, reserveOutputTokens: 100 });

    expect(builder.start(template, { topic: 'serums' })).toEqual([
      { role: 'system', content: 'You are a test.' },
      { role: 'user', content: 'Topic: serums' },
    ]);
  });

  it('renders only the fields a request provides', () => {
    const builder = new ContextBuilder({ contextTokens: 4000, reserveOutputTokens: 100 });
    const [, task] = builder.start(campaignBriefV1, {
      idea: 'A glow serum',
      platforms: ['TIKTOK'],
      contentType: 'UGC',
      language: 'ar',
    });

    expect(task.content).toContain('Brand idea: A glow serum');
    expect(task.content).not.toContain('Brand goal');
    expect(task.content).toContain('Arabic');
  });

  it('drops the oldest history first when over budget, keeping system and task', () => {
    const builder = new ContextBuilder({ contextTokens: 60, reserveOutputTokens: 10 });
    const long = 'x'.repeat(120);
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'task' },
      { role: 'assistant', content: `old ${long}` },
      { role: 'user', content: `old fix ${long}` },
      { role: 'assistant', content: 'recent' },
      { role: 'user', content: 'recent fix' },
    ];

    const fitted = builder.fit(messages);

    expect(fitted.slice(0, 2)).toEqual(messages.slice(0, 2));
    expect(fitted.map((message) => message.content)).toEqual([
      'sys',
      'task',
      'recent',
      'recent fix',
    ]);
    expect(estimateTokens(fitted)).toBeLessThanOrEqual(50);
  });

  it('never keeps a tool result without the call before it', () => {
    const builder = new ContextBuilder({ contextTokens: 40, reserveOutputTokens: 5 });
    const fitted = builder.fit([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'task' },
      {
        role: 'assistant',
        content: 'y'.repeat(200),
        toolCalls: [{ id: '1', name: 't', arguments: {} }],
      },
      { role: 'tool', content: 'result', toolCallId: '1' },
    ]);

    expect(fitted.some((message) => message.role === 'tool')).toBe(false);
  });

  it('clips the task itself when it alone exceeds the budget', () => {
    const builder = new ContextBuilder({ contextTokens: 100, reserveOutputTokens: 20 });
    const fitted = builder.start(template, { topic: 'word '.repeat(400) });

    expect(fitted).toHaveLength(2);
    expect(fitted[1].content.endsWith('…')).toBe(true);
    expect(estimateTokens(fitted)).toBeLessThanOrEqual(100);
  });
});
