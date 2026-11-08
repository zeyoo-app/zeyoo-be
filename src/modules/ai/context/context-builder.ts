import { ChatMessage } from '../llm/llm.types';
import { PromptTemplate } from '../prompts/prompt-template';

/** Rough token count (about four characters per token), good enough for budgeting. */
export function estimateTokens(messages: ChatMessage[]): number {
  const MESSAGE_OVERHEAD = 4;
  return messages.reduce(
    (total, message) => total + Math.ceil(message.content.length / 4) + MESSAGE_OVERHEAD,
    0,
  );
}

/** Shortens free text to `maxChars`, cutting at a word boundary and marking the cut. */
export function clip(text: string | null | undefined, maxChars: number): string {
  const value = (text ?? '').trim();
  if (value.length <= maxChars) {
    return value;
  }
  const cut = value.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export const CONTEXT_BUILDER = 'ContextBuilder';

export interface ContextBudget {
  /** The model's context window for this request. */
  contextTokens: number;
  /** Room kept free for the reply. */
  reserveOutputTokens: number;
}

/**
 * The single place prompts are assembled. Each feature hands over a template and the
 * minimal context it needs; this builds the messages and keeps them inside the budget.
 */
export class ContextBuilder {
  constructor(private readonly budget: ContextBudget) {}

  /** The opening messages: the template's instructions, then this request's task. */
  start<TContext>(template: PromptTemplate<TContext, unknown>, context: TContext): ChatMessage[] {
    return this.fit([
      { role: 'system', content: template.system },
      { role: 'user', content: template.renderTask(context) },
    ]);
  }

  /**
   * Keeps the system prompt and the task, then as many of the most recent turns as
   * fit. When even those two do not fit, the task is clipped.
   */
  fit(messages: ChatMessage[]): ChatMessage[] {
    const limit = this.budget.contextTokens - this.budget.reserveOutputTokens;
    if (estimateTokens(messages) <= limit) {
      return messages;
    }
    const [system, task, ...history] = messages;
    const head = [system, task].filter((message): message is ChatMessage => Boolean(message));
    const kept: ChatMessage[] = [];
    for (let index = history.length - 1; index >= 0; index -= 1) {
      const candidate = [history[index], ...kept];
      if (estimateTokens([...head, ...candidate]) > limit) {
        break;
      }
      kept.unshift(history[index]);
    }
    // A tool result is meaningless without the call that asked for it.
    while (kept[0]?.role === 'tool') {
      kept.shift();
    }
    const fitted = [...head, ...kept];
    if (estimateTokens(fitted) <= limit || !task) {
      return fitted;
    }
    const room = Math.max(limit - estimateTokens([system, ...kept]), 64) * 4;
    return [system, { ...task, content: clip(task.content, room) }, ...kept];
  }
}
