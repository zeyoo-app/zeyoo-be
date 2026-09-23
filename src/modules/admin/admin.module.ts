import { Module } from '@nestjs/common';
import { CampaignsModule } from '@modules/campaigns/campaigns.public';
import { IamModule } from '@modules/iam/iam.public';
import { AdminController } from './controllers/admin.controller';

@Module({
  imports: [IamModule, CampaignsModule],
  controllers: [AdminController],
})
export class AdminModule {}
