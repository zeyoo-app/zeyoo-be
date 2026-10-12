import { Module } from '@nestjs/common';
import { CampaignsModule } from '@modules/campaigns/campaigns.public';
import { CreatorsModule } from '@modules/creators/creators.public';
import { IamModule } from '@modules/iam/iam.public';
import { NotificationsModule } from '@modules/notifications/notifications.public';
import { SubmissionsModule } from '@modules/submissions/submissions.public';
import { AdminFraudController } from './controllers/admin-fraud.controller';
import { CampaignFraudController } from './controllers/campaign-fraud.controller';
import { FraudCasesController } from './controllers/fraud-cases.controller';
import { FraudService } from './services/fraud.service';

@Module({
  imports: [CampaignsModule, CreatorsModule, IamModule, NotificationsModule, SubmissionsModule],
  controllers: [CampaignFraudController, FraudCasesController, AdminFraudController],
  providers: [FraudService],
  exports: [FraudService],
})
export class FraudModule {}
