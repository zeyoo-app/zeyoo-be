import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { FraudCase, FraudCaseStatus } from '@prisma/client';
import { CurrentUser, Principal } from '@platform/auth';
import { Permission, RequirePermission } from '@platform/rbac';
import { FraudCaseView, FraudService } from '../services/fraud.service';

const STATUSES: FraudCaseStatus[] = ['OPEN', 'RESOLVED', 'DISMISSED'];

@ApiTags('admin')
@ApiBearerAuth()
@RequirePermission(Permission.AdminAccess)
@Controller('admin/fraud-cases')
export class AdminFraudController {
  constructor(private readonly fraud: FraudService) {}

  @Get()
  list(@Query('status') status?: string): Promise<FraudCaseView[]> {
    if (status && !STATUSES.includes(status as FraudCaseStatus)) {
      throw new BadRequestException('Unknown status.');
    }
    return this.fraud.listForAdmin(status as FraudCaseStatus | undefined);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':caseId/confirm')
  confirm(
    @CurrentUser() principal: Principal,
    @Param('caseId', ParseUUIDPipe) caseId: string,
  ): Promise<FraudCase> {
    return this.fraud.closeAsAdmin(caseId, principal.userId, 'RESOLVED');
  }

  @HttpCode(HttpStatus.OK)
  @Post(':caseId/clear')
  clear(
    @CurrentUser() principal: Principal,
    @Param('caseId', ParseUUIDPipe) caseId: string,
  ): Promise<FraudCase> {
    return this.fraud.closeAsAdmin(caseId, principal.userId, 'DISMISSED');
  }
}
