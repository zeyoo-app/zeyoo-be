import { Module } from '@nestjs/common';
import { AuthPlatformModule } from '@platform/auth';
import { AppConfigModule } from '@platform/config/app-config.module';
import { PrismaModule } from '@platform/database/prisma.module';
import { HealthModule } from '@platform/health/health.module';
import { MailModule } from '@platform/mail';
import { AdminModule } from '@modules/admin/admin.public';
import { AiModule } from '@modules/ai/ai.public';
import { AnalyticsModule } from '@modules/analytics/analytics.public';
import { ApplicationsModule } from '@modules/applications/applications.public';
import { BillingModule } from '@modules/billing/billing.public';
import { CampaignsModule } from '@modules/campaigns/campaigns.public';
import { CreatorsModule } from '@modules/creators/creators.public';
import { DisputesModule } from '@modules/disputes/disputes.public';
import { FraudModule } from '@modules/fraud/fraud.public';
import { IamModule } from '@modules/iam/iam.public';
import { MediaModule } from '@modules/media/media.public';
import { NotificationsModule } from '@modules/notifications/notifications.public';
import { PaymentsModule } from '@modules/payments/payments.public';
import { SocialModule } from '@modules/social/social.public';
import { SubmissionsModule } from '@modules/submissions/submissions.public';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    AuthPlatformModule,
    MailModule,
    HealthModule,
    IamModule,
    CampaignsModule,
    CreatorsModule,
    ApplicationsModule,
    SubmissionsModule,
    PaymentsModule,
    BillingModule,
    NotificationsModule,
    SocialModule,
    MediaModule,
    FraudModule,
    AnalyticsModule,
    DisputesModule,
    AdminModule,
    AiModule,
  ],
})
export class AppModule {}
