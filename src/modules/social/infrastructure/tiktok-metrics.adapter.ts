import { CreatorCredentials, PlatformMetricsAdapter } from '../domain/platform-metrics-adapter';
import { PostReference } from '../domain/post-reference';
import { MetricsUnavailableError, UnifiedPostMetrics } from '../domain/unified-metrics';
import { FetchFn, fetchJson, toCount } from './fetch-json';

const VIDEO_QUERY_ENDPOINT = 'https://open.tiktokapis.com/v2/video/query/';
const VIDEO_FIELDS = 'id,view_count,like_count,comment_count,share_count';

interface TikTokVideoQueryResponse {
  data?: { videos?: Record<string, number | string | undefined>[] };
  error?: { code?: string; message?: string };
}

/**
 * TikTok Display API `POST /v2/video/query/` (scope `video.list`). TikTok only
 * returns videos owned by the authorised user, so the creator must have connected
 * their account; their access token is used, not an app token.
 */
export class TikTokMetricsAdapter implements PlatformMetricsAdapter {
  readonly platform = 'TIKTOK' as const;
  readonly requiresCreatorToken = true;

  constructor(
    private readonly fetchFn: FetchFn,
    private readonly clientKey: string | undefined,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.clientKey);
  }

  async fetchMetrics(
    post: PostReference,
    credentials: CreatorCredentials | null,
  ): Promise<UnifiedPostMetrics> {
    if (!credentials) {
      throw new MetricsUnavailableError(
        'NEEDS_CREATOR_CONNECTION',
        'The creator has not connected TikTok.',
      );
    }
    const body = await fetchJson<TikTokVideoQueryResponse>(
      this.fetchFn,
      `${VIDEO_QUERY_ENDPOINT}?fields=${VIDEO_FIELDS}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ filters: { video_ids: [post.postId] } }),
      },
    );
    const video = body.data?.videos?.[0];
    if (!video) {
      throw new MetricsUnavailableError(
        'POST_NOT_FOUND',
        'The TikTok video was not found on the connected account.',
      );
    }
    const views = toCount(video.view_count);
    if (views === null) {
      throw new MetricsUnavailableError('UPSTREAM_ERROR', 'TikTok returned no view count.');
    }
    return {
      views,
      likes: toCount(video.like_count),
      comments: toCount(video.comment_count),
      shares: toCount(video.share_count),
      capturedAt: new Date(),
    };
  }
}
