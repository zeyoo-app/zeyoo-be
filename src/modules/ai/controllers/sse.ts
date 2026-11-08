import { Request, Response } from 'express';
import { AgentEvent } from '../agent/agent-runner';
import { describeAiFailure } from '../services/ai-errors';
import { AiResult, RunOptions } from '../services/ai-assistant.service';

const HEARTBEAT_MS = 15_000;

/** Every event a client can receive on an assistant stream. */
export type AiStreamEvent =
  | AgentEvent
  | ({ type: 'result' } & AiResult<unknown>)
  | { type: 'error'; code: string; message: string; retryable: boolean };

/**
 * Runs an assistant and streams its progress as server-sent events: status, tool and
 * partial-result events while it works, then exactly one `result` or `error`. Closing
 * the connection cancels the run (and the provider request behind it).
 */
export async function streamAssistant(
  _request: Request,
  response: Response,
  run: (options: RunOptions) => Promise<AiResult<unknown>>,
): Promise<void> {
  const abort = new AbortController();
  response.on('close', () => {
    if (!response.writableFinished) {
      abort.abort();
    }
  });

  response.status(200);
  response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  response.setHeader('Cache-Control', 'no-cache, no-transform');
  response.setHeader('Connection', 'keep-alive');
  // Stops reverse proxies from buffering the stream into one late chunk.
  response.setHeader('X-Accel-Buffering', 'no');
  response.flushHeaders();

  const send = (event: AiStreamEvent): void => {
    if (!response.writableEnded) {
      response.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  };
  const heartbeat = setInterval(() => {
    if (!response.writableEnded) {
      response.write(': ping\n\n');
    }
  }, HEARTBEAT_MS);

  try {
    const result = await run({ signal: abort.signal, onEvent: send });
    send({ type: 'result', ...result });
  } catch (error) {
    if (!abort.signal.aborted) {
      const failure = describeAiFailure(error);
      send({
        type: 'error',
        code: failure.code,
        message: failure.message,
        retryable: failure.retryable,
      });
    }
  } finally {
    clearInterval(heartbeat);
    response.end();
  }
}

/** For the plain JSON endpoints: cancels the run when the client disconnects. */
export function abortOnDisconnect(response: Response): AbortSignal {
  const abort = new AbortController();
  response.on('close', () => {
    if (!response.writableFinished) {
      abort.abort();
    }
  });
  return abort.signal;
}
