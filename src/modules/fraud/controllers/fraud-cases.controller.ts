import { Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { FraudCase } from '@prisma/client';
import { CurrentUser, Principal } from '@platform/auth';
import { Permission, RequirePermission } from '@platform/rbac';
import { FraudService } from '../services/fraud.service';

@ApiTags('fraud')
@ApiBearerAuth()
@RequirePermission(Permission.CampaignManage)
@Controller('fraud-cases')
export class FraudCasesController {
  constructor(private readonly fraud: FraudService) {}

  @HttpCode(HttpStatus.OK)
  @Post(':caseId/resolve')
  resolve(
    @CurrentUser() principal: Principal,
    @Param('caseId', ParseUUIDPipe) caseId: string,
  ): Promise<FraudCase> {
    return this.fraud.resolve(caseId, principal.userId);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':caseId/dismiss')
  dismiss(
    @CurrentUser() principal: Principal,
    @Param('caseId', ParseUUIDPipe) caseId: string,
  ): Promise<FraudCase> {
    return this.fraud.dismiss(caseId, principal.userId);
  }
}
