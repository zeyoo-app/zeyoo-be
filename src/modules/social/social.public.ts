// Public surface of the social module. Other modules import ONLY from here.
export { SocialModule } from './social.module';
export { MetricService } from './services/metric.service';
export { PlatformMetricsService } from './application/platform-metrics.service';
export { PlatformConnectionService } from './application/platform-connection.service';
export { parsePostUrl } from './domain/post-reference';
export { MetricsUnavailableError } from './domain/unified-metrics';
export type { MetricsUnavailableReason, UnifiedPostMetrics } from './domain/unified-metrics';
export type { EngagementReading } from './services/metric.service';
