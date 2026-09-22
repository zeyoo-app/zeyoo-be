import { Module } from '@nestjs/common';
import { ApplicationsModule } from '@modules/applications/applications.public';
import { CampaignsModule } from '@modules/campaigns/campaigns.public';
import { IamModule } from '@modules/iam/iam.public';
import { CampaignSubmissionsController } from './controllers/campaign-submissions.controller';
import { MySubmissionsController } from './controllers/my-submissions.controller';
import { SubmissionsController } from './controllers/submissions.controller';
import { ReviewService } from './services/review.service';
import { SubmissionService } from './services/submission.service';

@Module({
  imports: [CampaignsModule, IamModule, ApplicationsModule],
  controllers: [CampaignSubmissionsController, SubmissionsController, MySubmissionsController],
  providers: [SubmissionService, ReviewService],
  exports: [SubmissionService],
})
export class SubmissionsModule {}
