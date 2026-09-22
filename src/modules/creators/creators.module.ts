import { Module } from '@nestjs/common';
import { CreatorProfileController } from './controllers/creator-profile.controller';
import { CreatorSocialAccountsController } from './controllers/creator-social-accounts.controller';
import { CreatorsDirectoryController } from './controllers/creators-directory.controller';
import { CreatorProfileService } from './services/creator-profile.service';
import { SocialAccountService } from './services/social-account.service';

@Module({
  controllers: [
    CreatorProfileController,
    CreatorSocialAccountsController,
    CreatorsDirectoryController,
  ],
  providers: [CreatorProfileService, SocialAccountService],
  exports: [CreatorProfileService],
})
export class CreatorsModule {}
