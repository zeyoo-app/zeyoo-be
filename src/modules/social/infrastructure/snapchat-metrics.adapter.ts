import { PlatformMetricsAdapter } from '../domain/platform-metrics-adapter';
import { MetricsUnavailableError, UnifiedPostMetrics } from '../domain/unified-metrics';

/**
 * Snapchat has no public API for a post's view count (the Public Profile API is
 * restricted to approved partners), so views are always entered manually. The adapter
 * exists so the platform is recognised and the reason is explicit, not silent.
 */
export class SnapchatMetricsAdapter implements PlatformMetricsAdapter {
  readonly platform = 'SNAPCHAT' as const;
  readonly requiresCreatorToken = false;

  isConfigured(): boolean {
    return false;
  }

  fetchMetrics(): Promise<UnifiedPostMetrics> {
    return Promise.reject(
      new MetricsUnavailableError(
        'UNSUPPORTED_PLATFORM',
        'Snapchat does not provide view counts through a public API; enter views manually.',
      ),
    );
  }
}
