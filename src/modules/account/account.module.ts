import { Module } from '@nestjs/common';
import { CampaignsModule } from '@modules/campaigns/campaigns.public';
import { CreatorsModule } from '@modules/creators/creators.public';
import { IamModule } from '@modules/iam/iam.public';
import { NotificationsModule } from '@modules/notifications/notifications.public';
import { PaymentsModule } from '@modules/payments/payments.public';
import { SocialModule } from '@modules/social/social.public';
import { AccountController } from './account.controller';
import { AccountDeletionService } from './account-deletion.service';

@Module({
  imports: [
    IamModule,
    CampaignsModule,
    CreatorsModule,
    NotificationsModule,
    PaymentsModule,
    SocialModule,
  ],
  controllers: [AccountController],
  providers: [AccountDeletionService],
})
export class AccountModule {}
