import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { CampaignsModule } from '@modules/campaigns/campaigns.public';
import { CreatorsModule } from '@modules/creators/creators.public';
import { IamModule } from '@modules/iam/iam.public';
import { PaymentsModule } from '@modules/payments/payments.public';
import { AdminController } from './controllers/admin.controller';
import { AdminPeopleController } from './controllers/admin-people.controller';
import { AdminAuditInterceptor } from './infrastructure/admin-audit.interceptor';
import { AdminPeopleService } from './services/admin-people.service';
import { AdminReadService } from './services/admin-read.service';

@Module({
  imports: [IamModule, CampaignsModule, CreatorsModule, PaymentsModule],
  controllers: [AdminController, AdminPeopleController],
  providers: [
    AdminReadService,
    AdminPeopleService,
    AdminAuditInterceptor,
    { provide: APP_INTERCEPTOR, useExisting: AdminAuditInterceptor },
  ],
})
export class AdminModule {}
