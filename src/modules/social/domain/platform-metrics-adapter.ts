import { SocialPlatform } from '@prisma/client';
import { PostReference } from './post-reference';
import { UnifiedPostMetrics } from './unified-metrics';

/** What an adapter needs from the creator who owns the post, when it needs anything. */
export interface CreatorCredentials {
  accessToken: string;
  /** The platform's id for the creator's account (TikTok open_id, Instagram user id). */
  externalAccountId: string | null;
}

/**
 * Outbound port for reading a post's metrics from one platform. `requiresCreatorToken`
 * separates platforms that expose public counts to the app itself (YouTube, X) from
 * those that only reveal a post to the account that owns it (Instagram, TikTok).
 */
export interface PlatformMetricsAdapter {
  readonly platform: SocialPlatform;
  readonly requiresCreatorToken: boolean;
  /** False until the app-level keys for this platform are present in the environment. */
  isConfigured(): boolean;
  fetchMetrics(
    post: PostReference,
    credentials: CreatorCredentials | null,
  ): Promise<UnifiedPostMetrics>;
}

export const PLATFORM_METRICS_ADAPTERS = 'PlatformMetricsAdapters';
