import { Module } from '@nestjs/common';
import { EntitlementsService } from './services/entitlements.service';

@Module({
  providers: [EntitlementsService],
  exports: [EntitlementsService],
})
export class EntitlementsModule {}
