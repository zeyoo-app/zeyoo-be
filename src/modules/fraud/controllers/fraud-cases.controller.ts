import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { FraudCase } from '@prisma/client';
import { CurrentUser, Principal } from '@platform/auth';
import { Permission, RequirePermission } from '@platform/rbac';
import { FraudCaseView, FraudService } from '../services/fraud.service';

@ApiTags('fraud')
@ApiBearerAuth()
@Controller()
export class FraudCasesController {
  constructor(private readonly fraud: FraudService) {}

  @RequirePermission(Permission.ContentSubmit)
  @Get('me/fraud-cases')
  mine(@CurrentUser() principal: Principal): Promise<FraudCaseView[]> {
    return this.fraud.listForCreator(principal.userId);
  }

  @RequirePermission(Permission.CampaignManage)
  @HttpCode(HttpStatus.OK)
  @Post('fraud-cases/:caseId/resolve')
  resolve(
    @CurrentUser() principal: Principal,
    @Param('caseId', ParseUUIDPipe) caseId: string,
  ): Promise<FraudCase> {
    return this.fraud.closeAsBrand(caseId, principal.userId, 'RESOLVED');
  }

  @RequirePermission(Permission.CampaignManage)
  @HttpCode(HttpStatus.OK)
  @Post('fraud-cases/:caseId/dismiss')
  dismiss(
    @CurrentUser() principal: Principal,
    @Param('caseId', ParseUUIDPipe) caseId: string,
  ): Promise<FraudCase> {
    return this.fraud.closeAsBrand(caseId, principal.userId, 'DISMISSED');
  }
}
