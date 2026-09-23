import { Module } from '@nestjs/common';
import { ApplicationsModule } from '@modules/applications/applications.public';
import { CampaignsModule } from '@modules/campaigns/campaigns.public';
import { IamModule } from '@modules/iam/iam.public';
import { PaymentsModule } from '@modules/payments/payments.public';
import { SocialModule } from '@modules/social/social.public';
import { SubmissionsModule } from '@modules/submissions/submissions.public';
import { CampaignReportController } from './controllers/campaign-report.controller';
import { AnalyticsService } from './services/analytics.service';

@Module({
  imports: [
    CampaignsModule,
    IamModule,
    ApplicationsModule,
    SubmissionsModule,
    PaymentsModule,
    SocialModule,
  ],
  controllers: [CampaignReportController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
