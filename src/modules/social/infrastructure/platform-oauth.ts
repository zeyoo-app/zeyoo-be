import { SocialPlatform } from '@prisma/client';
import { MetricsUnavailableError } from '../domain/unified-metrics';
import { FetchFn, fetchJson } from './fetch-json';

const SECONDS_TO_MS = 1_000;

export interface PlatformTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  externalAccountId: string | null;
}

/** Who the platform says just connected, shown back to the creator and brands. */
export interface ConnectedAccount {
  externalAccountId: string | null;
  handle: string | null;
}

export interface OAuthAppCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** The OAuth dance for the platforms whose metrics sit behind the creator's own login. */
export interface PlatformOAuth {
  readonly platform: SocialPlatform;
  authorizationUrl(app: OAuthAppCredentials, state: string): string;
  exchangeCode(fetchFn: FetchFn, app: OAuthAppCredentials, code: string): Promise<PlatformTokens>;
  /** The connected account's display handle, looked up with the fresh token. */
  describeAccount(fetchFn: FetchFn, tokens: PlatformTokens): Promise<ConnectedAccount>;
  /** Null when the platform's tokens cannot be refreshed (the creator must reconnect). */
  refresh(
    fetchFn: FetchFn,
    app: OAuthAppCredentials,
    tokens: PlatformTokens,
  ): Promise<PlatformTokens | null>;
}

const expiresInSeconds = (seconds: number | undefined): Date | null =>
  seconds ? new Date(Date.now() + seconds * SECONDS_TO_MS) : null;

const formBody = (fields: Record<string, string>): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields).toString(),
});

interface TikTokTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  open_id?: string;
}

/** TikTok Login Kit v2: 24h access token, 365d refresh token, scope `video.list`. */
export const tiktokOAuth: PlatformOAuth = {
  platform: 'TIKTOK',
  authorizationUrl: (app, state) =>
    `https://www.tiktok.com/v2/auth/authorize/?${new URLSearchParams({
      client_key: app.clientId,
      scope: 'user.info.basic,video.list',
      response_type: 'code',
      redirect_uri: app.redirectUri,
      state,
    })}`,
  async exchangeCode(fetchFn, app, code) {
    const body = await fetchJson<TikTokTokenResponse>(
      fetchFn,
      'https://open.tiktokapis.com/v2/oauth/token/',
      formBody({
        client_key: app.clientId,
        client_secret: app.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: app.redirectUri,
      }),
    );
    return toTikTokTokens(body);
  },
  async describeAccount(fetchFn, tokens) {
    const body = await fetchJson<{ data?: { user?: { display_name?: string } } }>(
      fetchFn,
      'https://open.tiktokapis.com/v2/user/info/?fields=display_name',
      { headers: { Authorization: `Bearer ${tokens.accessToken}` } },
    );
    return {
      externalAccountId: tokens.externalAccountId,
      handle: body.data?.user?.display_name ?? null,
    };
  },
  async refresh(fetchFn, app, tokens) {
    if (!tokens.refreshToken) {
      return null;
    }
    const body = await fetchJson<TikTokTokenResponse>(
      fetchFn,
      'https://open.tiktokapis.com/v2/oauth/token/',
      formBody({
        client_key: app.clientId,
        client_secret: app.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: tokens.refreshToken,
      }),
    );
    return toTikTokTokens(body);
  },
};

function toTikTokTokens(body: TikTokTokenResponse): PlatformTokens {
  if (!body.access_token) {
    throw new MetricsUnavailableError('UPSTREAM_ERROR', 'TikTok did not return an access token.');
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? null,
    expiresAt: expiresInSeconds(body.expires_in),
    externalAccountId: body.open_id ?? null,
  };
}

interface InstagramShortLivedResponse {
  access_token?: string;
  user_id?: number | string;
}

interface InstagramLongLivedResponse {
  access_token?: string;
  expires_in?: number;
}

/**
 * Instagram Login: the code buys a short-lived token that is immediately swapped for
 * a 60-day one. There is no refresh token — the long-lived token itself is renewed.
 */
export const instagramOAuth: PlatformOAuth = {
  platform: 'INSTAGRAM',
  authorizationUrl: (app, state) =>
    `https://www.instagram.com/oauth/authorize?${new URLSearchParams({
      client_id: app.clientId,
      redirect_uri: app.redirectUri,
      response_type: 'code',
      scope: 'instagram_business_basic,instagram_business_manage_insights',
      state,
    })}`,
  async exchangeCode(fetchFn, app, code) {
    const shortLived = await fetchJson<InstagramShortLivedResponse>(
      fetchFn,
      'https://api.instagram.com/oauth/access_token',
      formBody({
        client_id: app.clientId,
        client_secret: app.clientSecret,
        grant_type: 'authorization_code',
        redirect_uri: app.redirectUri,
        code,
      }),
    );
    if (!shortLived.access_token) {
      throw new MetricsUnavailableError(
        'UPSTREAM_ERROR',
        'Instagram did not return an access token.',
      );
    }
    const query = new URLSearchParams({
      grant_type: 'ig_exchange_token',
      client_secret: app.clientSecret,
      access_token: shortLived.access_token,
    });
    const longLived = await fetchJson<InstagramLongLivedResponse>(
      fetchFn,
      `https://graph.instagram.com/access_token?${query}`,
    );
    return {
      accessToken: longLived.access_token ?? shortLived.access_token,
      refreshToken: null,
      expiresAt: expiresInSeconds(longLived.expires_in),
      externalAccountId: shortLived.user_id === undefined ? null : String(shortLived.user_id),
    };
  },
  async describeAccount(fetchFn, tokens) {
    const query = new URLSearchParams({ fields: 'username', access_token: tokens.accessToken });
    const body = await fetchJson<{ username?: string }>(
      fetchFn,
      `https://graph.instagram.com/me?${query}`,
    );
    return {
      externalAccountId: tokens.externalAccountId,
      handle: body.username ? `@${body.username}` : null,
    };
  },
  async refresh(fetchFn, _app, tokens) {
    const query = new URLSearchParams({
      grant_type: 'ig_refresh_token',
      access_token: tokens.accessToken,
    });
    const body = await fetchJson<InstagramLongLivedResponse>(
      fetchFn,
      `https://graph.instagram.com/refresh_access_token?${query}`,
    );
    if (!body.access_token) {
      return null;
    }
    return {
      ...tokens,
      accessToken: body.access_token,
      expiresAt: expiresInSeconds(body.expires_in),
    };
  },
};

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * YouTube via Google OAuth: read-only access to the creator's own channel. `offline`
 * access with a forced consent screen is what makes Google return a refresh token.
 */
export const youtubeOAuth: PlatformOAuth = {
  platform: 'YOUTUBE',
  authorizationUrl: (app, state) =>
    `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
      client_id: app.clientId,
      redirect_uri: app.redirectUri,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/youtube.readonly',
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    })}`,
  async exchangeCode(fetchFn, app, code) {
    const body = await fetchJson<GoogleTokenResponse>(
      fetchFn,
      GOOGLE_TOKEN_URL,
      formBody({
        client_id: app.clientId,
        client_secret: app.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: app.redirectUri,
      }),
    );
    return toGoogleTokens(body, null);
  },
  async describeAccount(fetchFn, tokens) {
    const body = await fetchJson<{
      items?: { id?: string; snippet?: { title?: string; customUrl?: string } }[];
    }>(fetchFn, 'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    const channel = body.items?.[0];
    if (!channel) {
      throw new MetricsUnavailableError(
        'UPSTREAM_ERROR',
        'No YouTube channel is linked to that Google account.',
      );
    }
    return {
      externalAccountId: channel.id ?? null,
      handle: channel.snippet?.customUrl ?? channel.snippet?.title ?? null,
    };
  },
  async refresh(fetchFn, app, tokens) {
    if (!tokens.refreshToken) {
      return null;
    }
    const body = await fetchJson<GoogleTokenResponse>(
      fetchFn,
      GOOGLE_TOKEN_URL,
      formBody({
        client_id: app.clientId,
        client_secret: app.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: tokens.refreshToken,
      }),
    );
    // Google does not send the refresh token again; keep the one we have.
    return toGoogleTokens(body, tokens.refreshToken);
  },
};

function toGoogleTokens(body: GoogleTokenResponse, keepRefreshToken: string | null): PlatformTokens {
  if (!body.access_token) {
    throw new MetricsUnavailableError('UPSTREAM_ERROR', 'Google did not return an access token.');
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? keepRefreshToken,
    expiresAt: expiresInSeconds(body.expires_in),
    externalAccountId: null,
  };
}

interface SnapchatTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

const SNAPCHAT_TOKEN_URL = 'https://accounts.snapchat.com/login/oauth2/access_token';

const snapchatBasicAuth = (app: OAuthAppCredentials): string =>
  `Basic ${Buffer.from(`${app.clientId}:${app.clientSecret}`).toString('base64')}`;

/**
 * Snapchat Login Kit: proves who the creator is (display name and external id). It
 * does not expose view counts, so Snapchat views stay manual — see SnapchatMetricsAdapter.
 */
export const snapchatOAuth: PlatformOAuth = {
  platform: 'SNAPCHAT',
  authorizationUrl: (app, state) =>
    `https://accounts.snapchat.com/accounts/oauth2/auth?${new URLSearchParams({
      client_id: app.clientId,
      redirect_uri: app.redirectUri,
      response_type: 'code',
      scope:
        'https://auth.snapchat.com/oauth2/api/user.display_name https://auth.snapchat.com/oauth2/api/user.external_id',
      state,
    })}`,
  async exchangeCode(fetchFn, app, code) {
    const body = await fetchJson<SnapchatTokenResponse>(fetchFn, SNAPCHAT_TOKEN_URL, {
      ...formBody({
        grant_type: 'authorization_code',
        code,
        redirect_uri: app.redirectUri,
      }),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: snapchatBasicAuth(app),
      },
    });
    return toSnapchatTokens(body);
  },
  async describeAccount(fetchFn, tokens) {
    const body = await fetchJson<{
      data?: { me?: { displayName?: string; externalId?: string } };
    }>(fetchFn, 'https://kit.snapchat.com/v1/me', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.accessToken}`,
      },
      body: JSON.stringify({ query: '{me{displayName externalId}}' }),
    });
    return {
      externalAccountId: body.data?.me?.externalId ?? null,
      handle: body.data?.me?.displayName ?? null,
    };
  },
  async refresh(fetchFn, app, tokens) {
    if (!tokens.refreshToken) {
      return null;
    }
    const body = await fetchJson<SnapchatTokenResponse>(fetchFn, SNAPCHAT_TOKEN_URL, {
      ...formBody({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken }),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: snapchatBasicAuth(app),
      },
    });
    return toSnapchatTokens(body);
  },
};

function toSnapchatTokens(body: SnapchatTokenResponse): PlatformTokens {
  if (!body.access_token) {
    throw new MetricsUnavailableError('UPSTREAM_ERROR', 'Snapchat did not return an access token.');
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? null,
    expiresAt: expiresInSeconds(body.expires_in),
    externalAccountId: null,
  };
}
