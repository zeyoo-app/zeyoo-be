import { CreatorCredentials, PlatformMetricsAdapter } from '../domain/platform-metrics-adapter';
import { PostReference } from '../domain/post-reference';
import { MetricsUnavailableError, UnifiedPostMetrics } from '../domain/unified-metrics';
import { FetchFn, fetchJson, toCount } from './fetch-json';

const GRAPH_BASE = 'https://graph.instagram.com';
const MEDIA_PAGE_SIZE = 50;
const MAX_MEDIA_PAGES = 6;
const INSIGHT_METRICS = 'views,shares';

interface MediaPage {
  data?: { id: string; permalink?: string; like_count?: number; comments_count?: number }[];
  paging?: { next?: string };
}

interface InsightsResponse {
  data?: { name: string; values?: { value?: number }[]; total_value?: { value?: number } }[];
}

/**
 * Instagram API with Instagram Login (scopes `instagram_business_basic`,
 * `instagram_business_manage_insights`). A link carries a shortcode but insights are
 * keyed by numeric media id, so the creator's own media is paged until the permalink
 * matches. Counts can lag by up to 48 hours (Meta's documented insight delay).
 */
export class InstagramMetricsAdapter implements PlatformMetricsAdapter {
  readonly platform = 'INSTAGRAM' as const;
  readonly requiresCreatorToken = true;

  constructor(
    private readonly fetchFn: FetchFn,
    private readonly appId: string | undefined,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.appId);
  }

  async fetchMetrics(
    post: PostReference,
    credentials: CreatorCredentials | null,
  ): Promise<UnifiedPostMetrics> {
    if (!credentials) {
      throw new MetricsUnavailableError(
        'NEEDS_CREATOR_CONNECTION',
        'The creator has not connected Instagram.',
      );
    }
    const media = await this.findOwnedMedia(post.postId, credentials.accessToken);
    const insights = await this.fetchInsights(media.id, credentials.accessToken);
    const views = toCount(insights.get('views'));
    if (views === null) {
      throw new MetricsUnavailableError('UPSTREAM_ERROR', 'Instagram returned no view count.');
    }
    return {
      views,
      likes: toCount(media.like_count),
      comments: toCount(media.comments_count),
      shares: toCount(insights.get('shares')),
      capturedAt: new Date(),
    };
  }

  private async findOwnedMedia(
    shortcode: string,
    accessToken: string,
  ): Promise<NonNullable<MediaPage['data']>[number]> {
    const query = new URLSearchParams({
      fields: 'id,permalink,like_count,comments_count',
      limit: String(MEDIA_PAGE_SIZE),
      access_token: accessToken,
    });
    let nextUrl: string | undefined = `${GRAPH_BASE}/me/media?${query}`;
    for (let page = 0; nextUrl && page < MAX_MEDIA_PAGES; page += 1) {
      const body: MediaPage = await fetchJson<MediaPage>(this.fetchFn, nextUrl);
      const match = body.data?.find((item) => item.permalink?.includes(`/${shortcode}`));
      if (match) {
        return match;
      }
      nextUrl = body.paging?.next;
    }
    throw new MetricsUnavailableError(
      'POST_NOT_FOUND',
      'The Instagram post was not found on the connected account.',
    );
  }

  private async fetchInsights(mediaId: string, accessToken: string): Promise<Map<string, number>> {
    const query = new URLSearchParams({ metric: INSIGHT_METRICS, access_token: accessToken });
    const body = await fetchJson<InsightsResponse>(
      this.fetchFn,
      `${GRAPH_BASE}/${mediaId}/insights?${query}`,
    );
    const metrics = new Map<string, number>();
    for (const entry of body.data ?? []) {
      const value = entry.total_value?.value ?? entry.values?.[0]?.value;
      if (typeof value === 'number') {
        metrics.set(entry.name, value);
      }
    }
    return metrics;
  }
}
