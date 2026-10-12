import { MetricsUnavailableError } from '../domain/unified-metrics';

const REQUEST_TIMEOUT_MS = 10_000;
const HTTP_NOT_FOUND = 404;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;

export type FetchFn = typeof fetch;
export const HTTP_FETCH = 'HttpFetch';

/**
 * GET/POST that returns parsed JSON and maps transport failures onto
 * MetricsUnavailableError, so adapters only deal with the happy-path shape.
 */
export async function fetchJson<TBody>(
  fetchFn: FetchFn,
  url: string,
  init: RequestInit = {},
): Promise<TBody> {
  let response: Response;
  try {
    response = await fetchFn(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    throw new MetricsUnavailableError(
      'UPSTREAM_ERROR',
      `Platform request failed: ${String(error)}`,
    );
  }
  if (response.ok) {
    return (await response.json()) as TBody;
  }
  throw toUnavailableError(response.status);
}

function toUnavailableError(status: number): MetricsUnavailableError {
  if (status === HTTP_NOT_FOUND) {
    return new MetricsUnavailableError('POST_NOT_FOUND', 'The post could not be found.');
  }
  if (status === HTTP_TOO_MANY_REQUESTS) {
    return new MetricsUnavailableError('RATE_LIMITED', 'The platform is rate limiting requests.');
  }
  if (status === HTTP_UNAUTHORIZED || status === HTTP_FORBIDDEN) {
    return new MetricsUnavailableError(
      'NEEDS_CREATOR_CONNECTION',
      'The platform rejected the credentials; the creator must reconnect.',
    );
  }
  return new MetricsUnavailableError('UPSTREAM_ERROR', `Platform responded with ${status}.`);
}

/** Platforms report counts as numbers or numeric strings; anything else is unknown. */
export function toCount(value: unknown): number | null {
  const count = typeof value === 'string' ? Number(value) : value;
  return typeof count === 'number' && Number.isInteger(count) && count >= 0 ? count : null;
}
