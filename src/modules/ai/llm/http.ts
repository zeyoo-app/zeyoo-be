import { LlmError } from './llm.types';

export type FetchFn = typeof fetch;

/** Joins the caller's cancel signal with a per-request timeout. */
export function withTimeout(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; timedOut: () => boolean } {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  return { signal: combined, timedOut: () => timeout.aborted && !signal?.aborted };
}

/** Maps an HTTP status from any provider onto the shared error codes. */
export function errorForStatus(status: number, detail: string): LlmError {
  if (status === 401 || status === 403) {
    return new LlmError('AUTH', `The AI provider rejected the credentials. ${detail}`.trim());
  }
  if (status === 402) {
    return new LlmError(
      'BILLING',
      `The AI provider account has no usage credits. ${detail}`.trim(),
    );
  }
  if (status === 404) {
    return new LlmError('MODEL_NOT_FOUND', `The AI model was not found. ${detail}`.trim());
  }
  if (status === 429) {
    return new LlmError('RATE_LIMITED', 'The AI provider is rate limiting requests.', true);
  }
  if (status >= 500) {
    return new LlmError('UNAVAILABLE', `The AI provider failed (${status}).`, true);
  }
  return new LlmError(
    'BAD_REQUEST',
    `The AI provider refused the request (${status}). ${detail}`.trim(),
  );
}

/** Turns a thrown fetch/abort error into an LlmError. */
export function errorForThrown(error: unknown, timedOut: boolean): LlmError {
  if (error instanceof LlmError) {
    return error;
  }
  if (timedOut) {
    return new LlmError('TIMEOUT', 'The AI provider took too long to answer.', true);
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return new LlmError('CANCELLED', 'The request was cancelled.');
  }
  return new LlmError('UNAVAILABLE', 'Could not reach the AI provider.', true);
}

export interface RetryPolicy {
  /** Extra attempts after the first; 0 disables retrying. */
  retries: number;
  baseDelayMs: number;
}

/**
 * Re-runs `task` on retryable LlmErrors with exponential backoff and jitter. Stops at
 * once on a non-retryable error or when the signal is aborted.
 */
export async function withRetry<T>(
  task: (attempt: number) => Promise<T>,
  policy: RetryPolicy,
  signal?: AbortSignal,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await task(attempt);
    } catch (error) {
      const retryable = error instanceof LlmError && error.retryable;
      if (!retryable || attempt >= policy.retries || signal?.aborted) {
        throw error;
      }
      const delay = policy.baseDelayMs * 2 ** attempt * (0.75 + Math.random() * 0.5);
      await sleep(delay, signal);
    }
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new LlmError('CANCELLED', 'The request was cancelled.'));
      },
      { once: true },
    );
  });
}

/**
 * Reads a fetch body as newline-delimited JSON objects. Each read races the signal,
 * so a stalled stream stops as soon as the request is cancelled or times out rather
 * than waiting for the socket to give up.
 */
export async function* readNdjson(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await readOrAbort(reader, signal);
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) {
          yield JSON.parse(line) as unknown;
        }
        newline = buffer.indexOf('\n');
      }
    }
    const rest = (buffer + decoder.decode()).trim();
    if (rest) {
      yield JSON.parse(rest) as unknown;
    }
  } finally {
    // Cancelling (not just releasing) closes the connection, which stops generation.
    await reader.cancel().catch(() => undefined);
  }
}

function readOrAbort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal,
): Promise<Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>['read']>>> {
  if (!signal) {
    return reader.read();
  }
  if (signal.aborted) {
    return Promise.reject(abortError());
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    reader.read().then(
      (result) => {
        signal.removeEventListener('abort', onAbort);
        resolve(result);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

function abortError(): Error {
  return Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
}
