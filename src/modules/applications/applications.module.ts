import { Module } from '@nestjs/common';
import { CampaignsModule } from '@modules/campaigns/campaigns.public';
import { IamModule } from '@modules/iam/iam.public';
import { ApplicationsController } from './controllers/applications.controller';
import { CampaignApplicationsController } from './controllers/campaign-applications.controller';
import { MyApplicationsController } from './controllers/my-applications.controller';
import { ApplicationService } from './services/application.service';

@Module({
  imports: [CampaignsModule, IamModule],
  controllers: [CampaignApplicationsController, ApplicationsController, MyApplicationsController],
  providers: [ApplicationService],
  exports: [ApplicationService],
})
export class ApplicationsModule {}
