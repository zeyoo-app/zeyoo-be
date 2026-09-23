import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Plan } from '@prisma/client';
import { BillingService } from '../services/billing.service';

@ApiTags('billing')
@ApiBearerAuth()
@Controller('billing/plans')
export class PlansController {
  constructor(private readonly billing: BillingService) {}

  @Get()
  list(): Promise<Plan[]> {
    return this.billing.listPlans();
  }
}
