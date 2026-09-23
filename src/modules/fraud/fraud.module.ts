import { Module } from '@nestjs/common';
import { CampaignsModule } from '@modules/campaigns/campaigns.public';
import { IamModule } from '@modules/iam/iam.public';
import { CampaignFraudController } from './controllers/campaign-fraud.controller';
import { FraudCasesController } from './controllers/fraud-cases.controller';
import { FraudService } from './services/fraud.service';

@Module({
  imports: [CampaignsModule, IamModule],
  controllers: [CampaignFraudController, FraudCasesController],
  providers: [FraudService],
  exports: [FraudService],
})
export class FraudModule {}
