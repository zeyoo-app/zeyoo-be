import { Module } from '@nestjs/common';
import { IamModule } from '@modules/iam/iam.public';
import { BillingWebhookController } from './controllers/billing-webhook.controller';
import { OrgSubscriptionController } from './controllers/org-subscription.controller';
import { PlansController } from './controllers/plans.controller';
import { StripeBillingGateway } from './infrastructure/stripe-billing-gateway';
import { BILLING_GATEWAY } from './ports/billing-gateway.port';
import { BillingService } from './services/billing.service';

@Module({
  imports: [IamModule],
  controllers: [PlansController, OrgSubscriptionController, BillingWebhookController],
  providers: [BillingService, { provide: BILLING_GATEWAY, useClass: StripeBillingGateway }],
  exports: [BillingService],
})
export class BillingModule {}
