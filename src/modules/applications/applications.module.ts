import { Module } from '@nestjs/common';
import { CampaignsModule } from '@modules/campaigns/campaigns.public';
import { CreatorsModule } from '@modules/creators/creators.public';
import { IamModule } from '@modules/iam/iam.public';
import { NotificationsModule } from '@modules/notifications/notifications.public';
import { ApplicationsController } from './controllers/applications.controller';
import { CampaignApplicationsController } from './controllers/campaign-applications.controller';
import { MyApplicationsController } from './controllers/my-applications.controller';
import { ApplicationService } from './services/application.service';

@Module({
  imports: [CampaignsModule, CreatorsModule, IamModule, NotificationsModule],
  controllers: [CampaignApplicationsController, ApplicationsController, MyApplicationsController],
  providers: [ApplicationService],
  exports: [ApplicationService],
})
export class ApplicationsModule {}
