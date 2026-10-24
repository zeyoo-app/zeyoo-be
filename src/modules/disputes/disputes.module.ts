import { Module } from '@nestjs/common';
import { CampaignsModule } from '@modules/campaigns/campaigns.public';
import { CreatorsModule } from '@modules/creators/creators.public';
import { FraudModule } from '@modules/fraud/fraud.public';
import { IamModule } from '@modules/iam/iam.public';
import { NotificationsModule } from '@modules/notifications/notifications.public';
import { PaymentsModule } from '@modules/payments/payments.public';
import { SubmissionsModule } from '@modules/submissions/submissions.public';
import { AdminDisputesController } from './controllers/admin-disputes.controller';
import { DisputesController } from './controllers/disputes.controller';
import { DisputeEscalationScheduler } from './services/dispute-escalation.scheduler';
import { DisputeService } from './services/dispute.service';

@Module({
  imports: [
    CampaignsModule,
    CreatorsModule,
    FraudModule,
    IamModule,
    NotificationsModule,
    PaymentsModule,
    SubmissionsModule,
  ],
  controllers: [DisputesController, AdminDisputesController],
  providers: [DisputeService, DisputeEscalationScheduler],
  exports: [DisputeService],
})
export class DisputesModule {}
