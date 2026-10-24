import { PostReference } from '../domain/post-reference';
import { MetricsUnavailableError } from '../domain/unified-metrics';
import { InstagramMetricsAdapter } from './instagram-metrics.adapter';
import { snapchatOAuth, youtubeOAuth } from './platform-oauth';
import { TikTokMetricsAdapter } from './tiktok-metrics.adapter';
import { XMetricsAdapter } from './x-metrics.adapter';
import { YouTubeMetricsAdapter } from './youtube-metrics.adapter';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

const post = (platform: PostReference['platform'], postId: string): PostReference => ({
  platform,
  postId,
  url: `https://example.test/${postId}`,
});

const credentials = { accessToken: 'creator-token', externalAccountId: 'acct-1' };

describe('YouTubeMetricsAdapter', () => {
  it('reads string counts and reports shares as unknown', async () => {
    const fetchFn = jest.fn().mockResolvedValue(
      jsonResponse({
        items: [{ statistics: { viewCount: '12345', likeCount: '99', commentCount: '7' } }],
      }),
    );
    const adapter = new YouTubeMetricsAdapter(fetchFn, 'api-key');

    const metrics = await adapter.fetchMetrics(post('YOUTUBE', 'abc12345678'));

    expect(metrics).toMatchObject({ views: 12_345, likes: 99, comments: 7, shares: null });
    expect(String(fetchFn.mock.calls[0][0])).toContain('id=abc12345678');
  });

  it('treats a hidden like count as unknown, not zero', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValue(jsonResponse({ items: [{ statistics: { viewCount: '10' } }] }));
    const adapter = new YouTubeMetricsAdapter(fetchFn, 'api-key');

    const metrics = await adapter.fetchMetrics(post('YOUTUBE', 'abc12345678'));

    expect(metrics.likes).toBeNull();
  });

  it('reports a missing video as not found', async () => {
    const fetchFn = jest.fn().mockResolvedValue(jsonResponse({ items: [] }));
    const adapter = new YouTubeMetricsAdapter(fetchFn, 'api-key');

    await expect(adapter.fetchMetrics(post('YOUTUBE', 'abc12345678'))).rejects.toMatchObject({
      reason: 'POST_NOT_FOUND',
    });
  });

  it('is unconfigured without an API key', () => {
    expect(new YouTubeMetricsAdapter(jest.fn(), undefined).isConfigured()).toBe(false);
  });
});

describe('XMetricsAdapter', () => {
  it('maps impressions to views and combines reposts and quotes into shares', async () => {
    const fetchFn = jest.fn().mockResolvedValue(
      jsonResponse({
        data: [
          {
            public_metrics: {
              impression_count: 5000,
              like_count: 40,
              reply_count: 3,
              retweet_count: 6,
              quote_count: 2,
            },
          },
        ],
      }),
    );
    const adapter = new XMetricsAdapter(fetchFn, 'bearer');

    const metrics = await adapter.fetchMetrics(post('X', '1790000000000000000'));

    expect(metrics).toMatchObject({ views: 5_000, likes: 40, comments: 3, shares: 8 });
    expect(fetchFn.mock.calls[0][1].headers.Authorization).toBe('Bearer bearer');
  });

  it('reports rate limiting distinctly', async () => {
    const fetchFn = jest.fn().mockResolvedValue(jsonResponse({}, 429));
    const adapter = new XMetricsAdapter(fetchFn, 'bearer');

    await expect(adapter.fetchMetrics(post('X', '1'))).rejects.toMatchObject({
      reason: 'RATE_LIMITED',
    });
  });
});

describe('TikTokMetricsAdapter', () => {
  it('queries the video with the creator token', async () => {
    const fetchFn = jest.fn().mockResolvedValue(
      jsonResponse({
        data: {
          videos: [{ id: '7', view_count: 800, like_count: 50, comment_count: 4, share_count: 2 }],
        },
      }),
    );
    const adapter = new TikTokMetricsAdapter(fetchFn, 'client-key');

    const metrics = await adapter.fetchMetrics(post('TIKTOK', '7'), credentials);

    expect(metrics).toMatchObject({ views: 800, likes: 50, comments: 4, shares: 2 });
    expect(JSON.parse(fetchFn.mock.calls[0][1].body)).toEqual({ filters: { video_ids: ['7'] } });
    expect(fetchFn.mock.calls[0][1].headers.Authorization).toBe('Bearer creator-token');
  });

  it('asks the creator to connect when there is no token', async () => {
    const adapter = new TikTokMetricsAdapter(jest.fn(), 'client-key');

    await expect(adapter.fetchMetrics(post('TIKTOK', '7'), null)).rejects.toMatchObject({
      reason: 'NEEDS_CREATOR_CONNECTION',
    });
  });

  it('treats a video outside the connected account as not found', async () => {
    const fetchFn = jest.fn().mockResolvedValue(jsonResponse({ data: { videos: [] } }));
    const adapter = new TikTokMetricsAdapter(fetchFn, 'client-key');

    await expect(adapter.fetchMetrics(post('TIKTOK', '7'), credentials)).rejects.toBeInstanceOf(
      MetricsUnavailableError,
    );
  });
});

describe('InstagramMetricsAdapter', () => {
  it('resolves the shortcode through the creator media list, then reads insights', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            { id: '111', permalink: 'https://www.instagram.com/reel/OTHERCODE/' },
            {
              id: '222',
              permalink: 'https://www.instagram.com/reel/C8aBcDeFgHi/',
              like_count: 30,
              comments_count: 5,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            { name: 'views', values: [{ value: 9000 }] },
            { name: 'shares', values: [{ value: 12 }] },
          ],
        }),
      );
    const adapter = new InstagramMetricsAdapter(fetchFn, 'app-id');

    const metrics = await adapter.fetchMetrics(post('INSTAGRAM', 'C8aBcDeFgHi'), credentials);

    expect(metrics).toMatchObject({ views: 9_000, likes: 30, comments: 5, shares: 12 });
    expect(String(fetchFn.mock.calls[1][0])).toContain('/222/insights');
  });

  it('follows pagination until the post is found', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: '1', permalink: 'https://www.instagram.com/p/AAA/' }],
          paging: { next: 'https://graph.instagram.com/next' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ data: [{ id: '2', permalink: 'https://www.instagram.com/p/TARGET/' }] }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [{ name: 'views', values: [{ value: 1 }] }] }));
    const adapter = new InstagramMetricsAdapter(fetchFn, 'app-id');

    await adapter.fetchMetrics(post('INSTAGRAM', 'TARGET'), credentials);

    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('reports a post that is not on the connected account', async () => {
    const fetchFn = jest.fn().mockResolvedValue(jsonResponse({ data: [] }));
    const adapter = new InstagramMetricsAdapter(fetchFn, 'app-id');

    await expect(
      adapter.fetchMetrics(post('INSTAGRAM', 'MISSING'), credentials),
    ).rejects.toMatchObject({
      reason: 'POST_NOT_FOUND',
    });
  });
});

describe('YouTube and Snapchat account connection', () => {
  const app = { clientId: 'cid', clientSecret: 'secret', redirectUri: 'https://app/cb' };

  it('asks Google for read-only YouTube access with a refresh token', () => {
    const url = new URL(youtubeOAuth.authorizationUrl(app, 'st'));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/youtube.readonly');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('state')).toBe('st');
  });

  it('describes the connected YouTube channel by its handle', async () => {
    const fetchFn = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ items: [{ id: 'UC1', snippet: { title: 'Chan', customUrl: '@chan' } }] }),
        { status: 200 },
      ),
    );
    const account = await youtubeOAuth.describeAccount(fetchFn, {
      accessToken: 't',
      refreshToken: null,
      expiresAt: null,
      externalAccountId: null,
    });
    expect(account).toEqual({ externalAccountId: 'UC1', handle: '@chan' });
  });

  it('rejects a Google account that has no YouTube channel', async () => {
    const fetchFn = jest.fn().mockResolvedValue(new Response('{"items":[]}', { status: 200 }));
    await expect(
      youtubeOAuth.describeAccount(fetchFn, {
        accessToken: 't',
        refreshToken: null,
        expiresAt: null,
        externalAccountId: null,
      }),
    ).rejects.toThrow('No YouTube channel');
  });

  it('describes the connected Snapchat account by its display name', async () => {
    const fetchFn = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { me: { displayName: 'Snappy', externalId: 'ext-1' } } }), {
        status: 200,
      }),
    );
    const account = await snapchatOAuth.describeAccount(fetchFn, {
      accessToken: 't',
      refreshToken: null,
      expiresAt: null,
      externalAccountId: null,
    });
    expect(account).toEqual({ externalAccountId: 'ext-1', handle: 'Snappy' });
  });
});
