import { PostReference } from '../domain/post-reference';
import { PlatformMetricsAdapter } from '../domain/platform-metrics-adapter';
import { MetricsUnavailableError, UnifiedPostMetrics } from '../domain/unified-metrics';
import { FetchFn, fetchJson, toCount } from './fetch-json';

const TWEETS_ENDPOINT = 'https://api.x.com/2/tweets';

interface XTweetsResponse {
  data?: { public_metrics?: Record<string, number | undefined> }[];
  errors?: unknown[];
}

/**
 * X API v2 `GET /2/tweets?tweet.fields=public_metrics` with an app-only bearer
 * token. `impression_count` is the view count; `retweet_count` + `quote_count` are
 * reported together as shares.
 */
export class XMetricsAdapter implements PlatformMetricsAdapter {
  readonly platform = 'X' as const;
  readonly requiresCreatorToken = false;

  constructor(
    private readonly fetchFn: FetchFn,
    private readonly bearerToken: string | undefined,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.bearerToken);
  }

  async fetchMetrics(post: PostReference): Promise<UnifiedPostMetrics> {
    const query = new URLSearchParams({ ids: post.postId, 'tweet.fields': 'public_metrics' });
    const body = await fetchJson<XTweetsResponse>(this.fetchFn, `${TWEETS_ENDPOINT}?${query}`, {
      headers: { Authorization: `Bearer ${this.bearerToken ?? ''}` },
    });
    const metrics = body.data?.[0]?.public_metrics;
    if (!metrics) {
      throw new MetricsUnavailableError('POST_NOT_FOUND', 'The X post was not found.');
    }
    const views = toCount(metrics.impression_count);
    if (views === null) {
      throw new MetricsUnavailableError('UPSTREAM_ERROR', 'X returned no impression count.');
    }
    return {
      views,
      likes: toCount(metrics.like_count),
      comments: toCount(metrics.reply_count),
      shares: sumKnown(toCount(metrics.retweet_count), toCount(metrics.quote_count)),
      capturedAt: new Date(),
    };
  }
}

function sumKnown(...counts: (number | null)[]): number | null {
  const known = counts.filter((count): count is number => count !== null);
  return known.length ? known.reduce((total, count) => total + count, 0) : null;
}
