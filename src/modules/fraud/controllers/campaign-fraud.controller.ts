import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { FraudCase, RiskLevel } from '@prisma/client';
import { CurrentUser, Principal } from '@platform/auth';
import { Permission, RequirePermission } from '@platform/rbac';
import { AssessEngagementDto, FlagFraudDto } from '../dto/fraud.dto';
import { FraudService } from '../services/fraud.service';

@ApiTags('fraud')
@ApiBearerAuth()
@RequirePermission(Permission.CampaignManage)
@Controller('campaigns/:campaignId')
export class CampaignFraudController {
  constructor(private readonly fraud: FraudService) {}

  @HttpCode(HttpStatus.OK)
  @Post('fraud/assess')
  assess(
    @CurrentUser() principal: Principal,
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Body() dto: AssessEngagementDto,
  ): Promise<{ level: RiskLevel }> {
    return this.fraud.assess(campaignId, principal.userId, dto);
  }

  @Post('fraud-cases')
  flag(
    @CurrentUser() principal: Principal,
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Body() dto: FlagFraudDto,
  ): Promise<FraudCase> {
    return this.fraud.flag(campaignId, principal.userId, dto);
  }

  @Get('fraud-cases')
  list(
    @CurrentUser() principal: Principal,
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
  ): Promise<FraudCase[]> {
    return this.fraud.listForCampaign(campaignId, principal.userId);
  }
}
