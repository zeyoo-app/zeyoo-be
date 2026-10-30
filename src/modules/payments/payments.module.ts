import { Module } from '@nestjs/common';
import { CampaignsModule } from '@modules/campaigns/campaigns.public';
import { CreatorsModule } from '@modules/creators/creators.public';
import { EntitlementsModule } from '@modules/entitlements/entitlements.public';
import { FraudModule } from '@modules/fraud/fraud.public';
import { IamModule } from '@modules/iam/iam.public';
import { NotificationsModule } from '@modules/notifications/notifications.public';
import { SocialModule } from '@modules/social/social.public';
import { SubmissionsModule } from '@modules/submissions/submissions.public';
import { EarningsSettlementService } from './application/earnings-settlement.service';
import { RefundService } from './application/refund.service';
import { ViewSyncScheduler } from './application/view-sync.scheduler';
import { ViewTrackingService } from './application/view-tracking.service';
import { EarningsController } from './controllers/earnings.controller';
import { ViewTrackingController } from './controllers/view-tracking.controller';
import { FundingService } from './application/funding.service';
import { LedgerService } from './application/ledger.service';
import { WalletService } from './application/wallet.service';
import { WithdrawalService } from './application/withdrawal.service';
import { AdminPayoutsController } from './controllers/admin-payouts.controller';
import { FundingController } from './controllers/funding.controller';
import { StripeWebhookController } from './controllers/stripe-webhook.controller';
import { WalletController } from './controllers/wallet.controller';
import { WithdrawalsController } from './controllers/withdrawals.controller';
import { LEDGER_REPOSITORY } from './domain/ports/ledger.repository';
import { PAYMENT_GATEWAY } from './domain/ports/payment-gateway.port';
import { PrismaLedgerRepository } from './infrastructure/prisma-ledger.repository';
import { StripePaymentGateway } from './infrastructure/stripe-payment-gateway';

@Module({
  imports: [
    CampaignsModule,
    EntitlementsModule,
    CreatorsModule,
    FraudModule,
    IamModule,
    SocialModule,
    SubmissionsModule,
    NotificationsModule,
  ],
  controllers: [
    FundingController,
    EarningsController,
    ViewTrackingController,
    WithdrawalsController,
    WalletController,
    AdminPayoutsController,
    StripeWebhookController,
  ],
  providers: [
    LedgerService,
    FundingService,
    EarningsSettlementService,
    RefundService,
    ViewTrackingService,
    ViewSyncScheduler,
    WithdrawalService,
    WalletService,
    { provide: LEDGER_REPOSITORY, useClass: PrismaLedgerRepository },
    { provide: PAYMENT_GATEWAY, useClass: StripePaymentGateway },
  ],
  exports: [
    LedgerService,
    FundingService,
    WalletService,
    WithdrawalService,
    EarningsSettlementService,
    RefundService,
  ],
})
export class PaymentsModule {}
