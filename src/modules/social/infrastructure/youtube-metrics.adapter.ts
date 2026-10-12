import { PostReference } from '../domain/post-reference';
import { PlatformMetricsAdapter } from '../domain/platform-metrics-adapter';
import { MetricsUnavailableError, UnifiedPostMetrics } from '../domain/unified-metrics';
import { FetchFn, fetchJson, toCount } from './fetch-json';

const VIDEOS_ENDPOINT = 'https://www.googleapis.com/youtube/v3/videos';

interface YouTubeVideosResponse {
  items?: { statistics?: Record<string, string | undefined> }[];
}

/**
 * YouTube Data API v3 `videos.list?part=statistics`. Public videos need only an API
 * key. Counts arrive as strings; `likeCount`/`commentCount` are omitted when the
 * owner hides them, and YouTube exposes no share count.
 */
export class YouTubeMetricsAdapter implements PlatformMetricsAdapter {
  readonly platform = 'YOUTUBE' as const;
  readonly requiresCreatorToken = false;

  constructor(
    private readonly fetchFn: FetchFn,
    private readonly apiKey: string | undefined,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async fetchMetrics(post: PostReference): Promise<UnifiedPostMetrics> {
    const query = new URLSearchParams({
      part: 'statistics',
      id: post.postId,
      key: this.apiKey ?? '',
    });
    const body = await fetchJson<YouTubeVideosResponse>(
      this.fetchFn,
      `${VIDEOS_ENDPOINT}?${query}`,
    );
    const statistics = body.items?.[0]?.statistics;
    if (!statistics) {
      throw new MetricsUnavailableError('POST_NOT_FOUND', 'The YouTube video was not found.');
    }
    const views = toCount(statistics.viewCount);
    if (views === null) {
      throw new MetricsUnavailableError('UPSTREAM_ERROR', 'YouTube returned no view count.');
    }
    return {
      views,
      likes: toCount(statistics.likeCount),
      comments: toCount(statistics.commentCount),
      shares: null,
      capturedAt: new Date(),
    };
  }
}
