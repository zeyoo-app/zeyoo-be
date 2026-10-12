import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '@platform/config/env.schema';
import { CampaignsModule } from '@modules/campaigns/campaigns.public';
import { CreatorsModule } from '@modules/creators/creators.public';
import { IamModule } from '@modules/iam/iam.public';
import { PlatformConnectionService } from './application/platform-connection.service';
import { PlatformMetricsService } from './application/platform-metrics.service';
import { CampaignMetricsController } from './controllers/campaign-metrics.controller';
import { PlatformConnectionsController } from './controllers/platform-connections.controller';
import { PLATFORM_METRICS_ADAPTERS } from './domain/platform-metrics-adapter';
import { HTTP_FETCH } from './infrastructure/fetch-json';
import { instagramOAuth, tiktokOAuth } from './infrastructure/platform-oauth';
import { InstagramMetricsAdapter } from './infrastructure/instagram-metrics.adapter';
import { SnapchatMetricsAdapter } from './infrastructure/snapchat-metrics.adapter';
import { TikTokMetricsAdapter } from './infrastructure/tiktok-metrics.adapter';
import { XMetricsAdapter } from './infrastructure/x-metrics.adapter';
import { YouTubeMetricsAdapter } from './infrastructure/youtube-metrics.adapter';
import { MetricService } from './services/metric.service';

@Module({
  imports: [CampaignsModule, CreatorsModule, IamModule],
  controllers: [CampaignMetricsController, PlatformConnectionsController],
  providers: [
    MetricService,
    PlatformConnectionService,
    PlatformMetricsService,
    { provide: HTTP_FETCH, useValue: fetch },
    { provide: 'PLATFORM_OAUTH_PROVIDERS', useValue: [instagramOAuth, tiktokOAuth] },
    {
      provide: PLATFORM_METRICS_ADAPTERS,
      inject: [ConfigService, HTTP_FETCH],
      useFactory: (config: ConfigService<Env, true>, fetchFn: typeof fetch) => [
        new YouTubeMetricsAdapter(fetchFn, config.get('YOUTUBE_API_KEY', { infer: true })),
        new XMetricsAdapter(fetchFn, config.get('X_BEARER_TOKEN', { infer: true })),
        new TikTokMetricsAdapter(fetchFn, config.get('TIKTOK_CLIENT_KEY', { infer: true })),
        new InstagramMetricsAdapter(fetchFn, config.get('INSTAGRAM_APP_ID', { infer: true })),
        new SnapchatMetricsAdapter(),
      ],
    },
  ],
  exports: [MetricService, PlatformMetricsService, PlatformConnectionService],
})
export class SocialModule {}
