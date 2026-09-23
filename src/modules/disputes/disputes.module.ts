import { Module } from '@nestjs/common';
import { AdminDisputesController } from './controllers/admin-disputes.controller';
import { DisputesController } from './controllers/disputes.controller';
import { DisputeService } from './services/dispute.service';

@Module({
  controllers: [DisputesController, AdminDisputesController],
  providers: [DisputeService],
  exports: [DisputeService],
})
export class DisputesModule {}
