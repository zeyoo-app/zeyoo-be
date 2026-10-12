import { Module } from '@nestjs/common';
import { NotificationsModule } from '@modules/notifications/notifications.public';
import { CreatorProfileController } from './controllers/creator-profile.controller';
import { CreatorSocialAccountsController } from './controllers/creator-social-accounts.controller';
import { CreatorsDirectoryController } from './controllers/creators-directory.controller';
import { CreatorProfileService } from './services/creator-profile.service';
import { SocialAccountService } from './services/social-account.service';

@Module({
  imports: [NotificationsModule],
  controllers: [
    CreatorProfileController,
    CreatorSocialAccountsController,
    CreatorsDirectoryController,
  ],
  providers: [CreatorProfileService, SocialAccountService],
  exports: [CreatorProfileService, SocialAccountService],
})
export class CreatorsModule {}
