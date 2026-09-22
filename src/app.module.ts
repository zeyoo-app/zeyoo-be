import { Module } from '@nestjs/common';
import { AuthPlatformModule } from '@platform/auth';
import { AppConfigModule } from '@platform/config/app-config.module';
import { PrismaModule } from '@platform/database/prisma.module';
import { HealthModule } from '@platform/health/health.module';
import { ApplicationsModule } from '@modules/applications/applications.public';
import { CampaignsModule } from '@modules/campaigns/campaigns.public';
import { CreatorsModule } from '@modules/creators/creators.public';
import { IamModule } from '@modules/iam/iam.public';
import { SubmissionsModule } from '@modules/submissions/submissions.public';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    AuthPlatformModule,
    HealthModule,
    IamModule,
    CampaignsModule,
    CreatorsModule,
    ApplicationsModule,
    SubmissionsModule,
  ],
})
export class AppModule {}
