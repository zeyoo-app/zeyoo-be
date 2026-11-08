import { readNdjson, withRetry } from './http';
import { LlmError } from './llm.types';

describe('withRetry', () => {
  it('retries retryable errors up to the limit, then rethrows', async () => {
    const task = jest.fn().mockRejectedValue(new LlmError('UNAVAILABLE', 'down', true));

    await expect(withRetry(task, { retries: 2, baseDelayMs: 1 })).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
    expect(task).toHaveBeenCalledTimes(3);
  });

  it('does not retry a non-retryable error', async () => {
    const task = jest.fn().mockRejectedValue(new LlmError('AUTH', 'bad key'));

    await expect(withRetry(task, { retries: 5, baseDelayMs: 1 })).rejects.toMatchObject({
      code: 'AUTH',
    });
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('returns the first success', async () => {
    const task = jest
      .fn()
      .mockRejectedValueOnce(new LlmError('RATE_LIMITED', 'slow', true))
      .mockResolvedValue('ok');

    await expect(withRetry(task, { retries: 2, baseDelayMs: 1 })).resolves.toBe('ok');
    expect(task).toHaveBeenCalledTimes(2);
  });

  it('stops waiting when the caller cancels during backoff', async () => {
    const controller = new AbortController();
    const task = jest.fn().mockRejectedValue(new LlmError('UNAVAILABLE', 'down', true));
    const pending = withRetry(task, { retries: 3, baseDelayMs: 10_000 }, controller.signal);
    await Promise.resolve();
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});

describe('readNdjson', () => {
  it('reassembles lines split across chunks and skips blank lines', async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        ['{"a":', '1}\n\n{"b"', ':2}'].forEach((chunk) =>
          controller.enqueue(encoder.encode(chunk)),
        );
        controller.close();
      },
    });
    const out: unknown[] = [];
    for await (const item of readNdjson(body)) {
      out.push(item);
    }

    expect(out).toEqual([{ a: 1 }, { b: 2 }]);
  });
});

describe('readNdjson cancellation', () => {
  it('stops a stalled stream as soon as the signal aborts', async () => {
    const cancel = jest.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"a":1}\n'));
        // Never closes: a provider that stopped sending.
      },
      cancel,
    });
    const controller = new AbortController();
    const seen: unknown[] = [];
    const reading = (async () => {
      for await (const item of readNdjson(body, controller.signal)) {
        seen.push(item);
        setTimeout(() => controller.abort(), 10);
      }
    })();

    await expect(reading).rejects.toMatchObject({ name: 'AbortError' });
    expect(seen).toEqual([{ a: 1 }]);
    expect(cancel).toHaveBeenCalled();
  });
});
