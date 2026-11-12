import { ZodType, ZodTypeDef } from 'zod';
import { ContextBuilder } from '../context/context-builder';
import {
  ChatMessage,
  LlmError,
  LlmProvider,
  TokenUsage,
  ToolCall,
  ToolSpec,
} from '../llm/llm.types';
import { fitToSchema } from './fit-to-schema';
import { parsePartialJson } from './partial-json';

/** A function the model may call during a run, with validated arguments. */
export interface AgentTool<TArgs = unknown> {
  spec: ToolSpec;
  args: ZodType<TArgs, ZodTypeDef, unknown>;
  /** Short, user-facing label for progress UIs, e.g. "Reading the campaign". */
  label: string;
  run(args: TArgs, signal: AbortSignal): Promise<unknown>;
}

export type AgentStage = 'thinking' | 'writing' | 'checking' | 'fixing';

/** What a run reports while it works. Streamed to clients as server-sent events. */
export type AgentEvent =
  | { type: 'status'; stage: AgentStage }
  | { type: 'partial'; data: unknown }
  | { type: 'tool_call'; id: string; name: string; label: string }
  | { type: 'tool_result'; id: string; name: string; ok: boolean };

export interface AgentRunInput<TOutput> {
  provider: LlmProvider;
  model: string;
  messages: ChatMessage[];
  output: ZodType<TOutput, ZodTypeDef, unknown>;
  outputSchema: Record<string, unknown>;
  temperature: number;
  maxOutputTokens: number;
  contextTokens: number;
  tools?: AgentTool[];
  signal: AbortSignal;
  onEvent?: (event: AgentEvent) => void;
}

export interface AgentRunResult<TOutput> {
  data: TOutput;
  model: string;
  usage: TokenUsage;
  /** Model calls made, including tool rounds and repairs. */
  steps: number;
}

export interface AgentLimits {
  /** Model calls allowed in one run (tool rounds plus repairs). */
  maxSteps: number;
  /** Times a reply that fails the schema is sent back to be fixed. */
  maxRepairs: number;
  /** Minimum gap between partial-result events. */
  partialIntervalMs: number;
}

export const DEFAULT_AGENT_LIMITS: AgentLimits = {
  maxSteps: 6,
  maxRepairs: 2,
  partialIntervalMs: 120,
};

/**
 * How far the output budget may grow when replies keep getting cut off: thinking
 * models spend part of it reasoning before they write, so a fixed budget that suits
 * one model cuts another short.
 */
const MAX_OUTPUT_GROWTH = 4;

/** The model's final reply could not be turned into a valid result. */
export class AgentOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentOutputError';
  }
}

/**
 * Plan → act → observe. Each step asks the model; tool calls are validated, run and
 * fed back; a final reply is parsed and checked against the schema, and an invalid
 * one is returned to the model with the problems listed. Bounded by `limits`.
 */
export class AgentRunner {
  constructor(
    private readonly context: ContextBuilder,
    private readonly limits: AgentLimits = DEFAULT_AGENT_LIMITS,
  ) {}

  async run<TOutput>(input: AgentRunInput<TOutput>): Promise<AgentRunResult<TOutput>> {
    const tools = new Map((input.tools ?? []).map((tool) => [tool.spec.name, tool]));
    let messages = input.messages;
    let repairs = 0;
    let maxOutputTokens = input.maxOutputTokens;
    const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

    for (let step = 1; step <= this.limits.maxSteps; step += 1) {
      this.throwIfCancelled(input.signal);
      input.onEvent?.({
        type: 'status',
        stage: step === 1 ? 'thinking' : repairs > 0 ? 'fixing' : 'thinking',
      });

      const reply = await this.callModel(input, messages, tools, maxOutputTokens);
      addUsage(usage, reply.usage);

      if (reply.cutOff) {
        // Ask again with more room rather than failing; the cut-off text is discarded.
        if (maxOutputTokens >= input.maxOutputTokens * MAX_OUTPUT_GROWTH) {
          throw new AgentOutputError('The AI reply was cut off before it finished.');
        }
        maxOutputTokens *= 2;
        continue;
      }

      if (reply.toolCalls.length > 0) {
        messages = this.context.fit([
          ...messages,
          { role: 'assistant', content: reply.content, toolCalls: reply.toolCalls },
          ...(await this.runTools(reply.toolCalls, tools, input)),
        ]);
        continue;
      }

      input.onEvent?.({ type: 'status', stage: 'checking' });
      const problems = this.validate(reply.content, input.output);
      if (problems.ok) {
        return { data: problems.data, model: reply.model, usage, steps: step };
      }
      if (repairs >= this.limits.maxRepairs) {
        throw new AgentOutputError(
          `The AI reply did not match the expected format: ${problems.error}`,
        );
      }
      repairs += 1;
      messages = this.context.fit([
        ...messages,
        { role: 'assistant', content: reply.content },
        {
          role: 'user',
          content: `That reply was not valid: ${problems.error}\nSend the whole JSON object again, corrected, and nothing else.`,
        },
      ]);
    }
    throw new AgentOutputError('The AI assistant needed too many steps to finish.');
  }

  private async callModel(
    input: AgentRunInput<unknown>,
    messages: ChatMessage[],
    tools: Map<string, AgentTool>,
    maxOutputTokens: number,
  ): Promise<{
    content: string;
    toolCalls: ToolCall[];
    usage: TokenUsage;
    model: string;
    cutOff: boolean;
  }> {
    let text = '';
    let lastPartialAt = 0;
    let announcedWriting = false;
    for await (const event of input.provider.stream({
      model: input.model,
      messages,
      tools: tools.size ? [...tools.values()].map((tool) => tool.spec) : undefined,
      responseSchema: input.outputSchema,
      temperature: input.temperature,
      maxOutputTokens,
      contextTokens: input.contextTokens,
      signal: input.signal,
    })) {
      if (event.type === 'delta') {
        text += event.text;
        if (!announcedWriting) {
          announcedWriting = true;
          input.onEvent?.({ type: 'status', stage: 'writing' });
        }
        const now = Date.now();
        if (input.onEvent && now - lastPartialAt >= this.limits.partialIntervalMs) {
          const partial = parsePartialJson(text);
          if (partial !== undefined) {
            lastPartialAt = now;
            input.onEvent({ type: 'partial', data: partial });
          }
        }
      } else if (event.type === 'done') {
        return {
          content: event.result.content,
          toolCalls: event.result.toolCalls,
          usage: event.result.usage,
          model: event.result.model,
          cutOff: event.result.finishReason === 'length',
        };
      }
    }
    throw new LlmError('UNAVAILABLE', 'The AI provider ended the reply early.', true);
  }

  private async runTools(
    calls: ToolCall[],
    tools: Map<string, AgentTool>,
    input: AgentRunInput<unknown>,
  ): Promise<ChatMessage[]> {
    return Promise.all(
      calls.map(async (call): Promise<ChatMessage> => {
        const tool = tools.get(call.name);
        input.onEvent?.({
          type: 'tool_call',
          id: call.id,
          name: call.name,
          label: tool?.label ?? call.name,
        });
        const answer = await this.runTool(call, tool, input.signal);
        input.onEvent?.({ type: 'tool_result', id: call.id, name: call.name, ok: answer.ok });
        return { role: 'tool', toolCallId: call.id, toolName: call.name, content: answer.content };
      }),
    );
  }

  /** Errors go back to the model as the tool's answer, so it can recover. */
  private async runTool(
    call: ToolCall,
    tool: AgentTool | undefined,
    signal: AbortSignal,
  ): Promise<{ ok: boolean; content: string }> {
    if (!tool) {
      return { ok: false, content: JSON.stringify({ error: `Unknown tool "${call.name}".` }) };
    }
    const args = tool.args.safeParse(call.arguments);
    if (!args.success) {
      return {
        ok: false,
        content: JSON.stringify({ error: `Invalid arguments: ${formatIssues(args.error.issues)}` }),
      };
    }
    try {
      return { ok: true, content: JSON.stringify(await tool.run(args.data, signal)) };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The tool failed.';
      return { ok: false, content: JSON.stringify({ error: message }) };
    }
  }

  private validate<TOutput>(
    content: string,
    schema: ZodType<TOutput, ZodTypeDef, unknown>,
  ): { ok: true; data: TOutput } | { ok: false; error: string } {
    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJson(content));
    } catch {
      return { ok: false, error: 'it was not valid JSON' };
    }
    const result = schema.safeParse(fitToSchema(schema, parsed));
    return result.success
      ? { ok: true, data: result.data }
      : { ok: false, error: formatIssues(result.error.issues) };
  }

  private throwIfCancelled(signal: AbortSignal): void {
    if (signal.aborted) {
      throw new LlmError('CANCELLED', 'The request was cancelled.');
    }
  }
}

/** Some models wrap JSON in a code fence or add a sentence; take the outermost object. */
function extractJson(content: string): string {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  return start >= 0 && end > start ? content.slice(start, end + 1) : content;
}

function formatIssues(issues: { path: (string | number)[]; message: string }[]): string {
  return issues
    .slice(0, 6)
    .map((issue) => `${issue.path.join('.') || 'value'}: ${issue.message}`)
    .join('; ');
}

function addUsage(total: TokenUsage, next: TokenUsage): void {
  total.inputTokens = (total.inputTokens ?? 0) + (next.inputTokens ?? 0);
  total.outputTokens = (total.outputTokens ?? 0) + (next.outputTokens ?? 0);
}
