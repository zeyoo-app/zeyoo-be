import { Inject, Injectable } from '@nestjs/common';
import { SocialPlatform } from '@prisma/client';
import {
  PLATFORM_METRICS_ADAPTERS,
  PlatformMetricsAdapter,
} from '../domain/platform-metrics-adapter';
import { PostReference, parsePostUrl } from '../domain/post-reference';
import { MetricsUnavailableError, UnifiedPostMetrics } from '../domain/unified-metrics';
import { PlatformConnectionService } from './platform-connection.service';

export interface FetchedPostMetrics {
  platform: SocialPlatform;
  metrics: UnifiedPostMetrics;
}

/**
 * Reads a submitted post's metrics from whichever platform it lives on, through the
 * matching adapter, and returns them in the one unified shape. Anything that stops
 * an automatic read arrives as a MetricsUnavailableError whose reason tells callers
 * whether manual entry (or the creator connecting an account) is the way forward.
 */
@Injectable()
export class PlatformMetricsService {
  constructor(
    @Inject(PLATFORM_METRICS_ADAPTERS) private readonly adapters: PlatformMetricsAdapter[],
    private readonly connections: PlatformConnectionService,
  ) {}

  identify(postUrl: string): PostReference {
    const post = parsePostUrl(postUrl);
    if (!post) {
      throw new MetricsUnavailableError(
        'UNSUPPORTED_PLATFORM',
        'This link is not a recognised post URL; enter views manually.',
      );
    }
    return post;
  }

  async fetchForPost(postUrl: string, creatorUserId: string): Promise<FetchedPostMetrics> {
    const post = this.identify(postUrl);
    const adapter = this.adapters.find((candidate) => candidate.platform === post.platform);
    if (!adapter) {
      throw new MetricsUnavailableError(
        'UNSUPPORTED_PLATFORM',
        `${post.platform} is not supported.`,
      );
    }
    if (!adapter.isConfigured()) {
      throw new MetricsUnavailableError(
        adapter.platform === 'SNAPCHAT' ? 'UNSUPPORTED_PLATFORM' : 'NOT_CONFIGURED',
        `Automatic ${post.platform} tracking is not available; enter views manually.`,
      );
    }
    const credentials = adapter.requiresCreatorToken
      ? await this.connections.credentialsFor(post.platform, creatorUserId)
      : null;
    return { platform: post.platform, metrics: await adapter.fetchMetrics(post, credentials) };
  }
}
