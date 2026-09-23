import { Module } from '@nestjs/common';
import { CampaignsModule } from '@modules/campaigns/campaigns.public';
import { IamModule } from '@modules/iam/iam.public';
import { CampaignMetricsController } from './controllers/campaign-metrics.controller';
import { MetricService } from './services/metric.service';

@Module({
  imports: [CampaignsModule, IamModule],
  controllers: [CampaignMetricsController],
  providers: [MetricService],
  exports: [MetricService],
})
export class SocialModule {}
