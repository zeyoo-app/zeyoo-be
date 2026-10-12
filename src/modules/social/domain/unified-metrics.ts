/**
 * One post's performance in a platform-neutral shape. A count a platform does not
 * expose is null rather than 0, so "unknown" is never mistaken for "none".
 */
export interface UnifiedPostMetrics {
  views: number;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  capturedAt: Date;
}

export type MetricsUnavailableReason =
  /** The platform has no usable public API, so views must be entered manually. */
  | 'UNSUPPORTED_PLATFORM'
  /** The adapter's platform credentials have not been configured on the server. */
  | 'NOT_CONFIGURED'
  /** The creator must connect (or reconnect) their account before metrics can be read. */
  | 'NEEDS_CREATOR_CONNECTION'
  | 'POST_NOT_FOUND'
  | 'RATE_LIMITED'
  | 'UPSTREAM_ERROR';

/** Raised when a platform's metrics cannot be read; the reason drives the user message. */
export class MetricsUnavailableError extends Error {
  constructor(
    readonly reason: MetricsUnavailableReason,
    message: string,
  ) {
    super(message);
    this.name = 'MetricsUnavailableError';
  }
}
