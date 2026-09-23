import { Module } from '@nestjs/common';
import { CampaignsModule } from '@modules/campaigns/campaigns.public';
import { IamModule } from '@modules/iam/iam.public';
import { FundingService } from './application/funding.service';
import { LedgerService } from './application/ledger.service';
import { WithdrawalService } from './application/withdrawal.service';
import { AdminPayoutsController } from './controllers/admin-payouts.controller';
import { FundingController } from './controllers/funding.controller';
import { StripeWebhookController } from './controllers/stripe-webhook.controller';
import { WithdrawalsController } from './controllers/withdrawals.controller';
import { LEDGER_REPOSITORY } from './domain/ports/ledger.repository';
import { PAYMENT_GATEWAY } from './domain/ports/payment-gateway.port';
import { PrismaLedgerRepository } from './infrastructure/prisma-ledger.repository';
import { StripePaymentGateway } from './infrastructure/stripe-payment-gateway';

@Module({
  imports: [CampaignsModule, IamModule],
  controllers: [
    FundingController,
    WithdrawalsController,
    AdminPayoutsController,
    StripeWebhookController,
  ],
  providers: [
    LedgerService,
    FundingService,
    WithdrawalService,
    { provide: LEDGER_REPOSITORY, useClass: PrismaLedgerRepository },
    { provide: PAYMENT_GATEWAY, useClass: StripePaymentGateway },
  ],
  exports: [LedgerService, FundingService],
})
export class PaymentsModule {}
