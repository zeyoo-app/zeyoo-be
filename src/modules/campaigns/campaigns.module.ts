import { Module } from '@nestjs/common';
import { CreatorsModule } from '@modules/creators/creators.public';
import { IamModule } from '@modules/iam/iam.public';
import { NotificationsModule } from '@modules/notifications/notifications.public';
import { CampaignInvitationsController } from './controllers/campaign-invitations.controller';
import { MyInvitationsController } from './controllers/my-invitations.controller';
import { CampaignsController } from './controllers/campaigns.controller';
import { CategoriesController } from './controllers/categories.controller';
import { OrgCampaignsController } from './controllers/org-campaigns.controller';
import { CampaignService } from './services/campaign.service';
import { CategoryService } from './services/category.service';
import { InvitationService } from './services/invitation.service';

@Module({
  imports: [CreatorsModule, IamModule, NotificationsModule],
  controllers: [
    OrgCampaignsController,
    CampaignsController,
    CampaignInvitationsController,
    MyInvitationsController,
    CategoriesController,
  ],
  providers: [CampaignService, CategoryService, InvitationService],
  exports: [CampaignService, InvitationService, CategoryService],
})
export class CampaignsModule {}
