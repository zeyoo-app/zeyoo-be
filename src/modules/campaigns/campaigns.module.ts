import { Module } from '@nestjs/common';
import { IamModule } from '@modules/iam/iam.public';
import { CampaignInvitationsController } from './controllers/campaign-invitations.controller';
import { CampaignsController } from './controllers/campaigns.controller';
import { CategoriesController } from './controllers/categories.controller';
import { OrgCampaignsController } from './controllers/org-campaigns.controller';
import { CampaignService } from './services/campaign.service';
import { CategoryService } from './services/category.service';
import { InvitationService } from './services/invitation.service';

@Module({
  imports: [IamModule],
  controllers: [
    OrgCampaignsController,
    CampaignsController,
    CampaignInvitationsController,
    CategoriesController,
  ],
  providers: [CampaignService, CategoryService, InvitationService],
  exports: [CampaignService],
})
export class CampaignsModule {}
