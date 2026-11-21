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
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { CurrentUser, Principal } from '@platform/auth';
import { Permission, RequirePermission } from '@platform/rbac';
import {
  ApprovalPayoutService,
  ApprovalResult,
  PayoutPreview,
} from '../application/approval-payout.service';

class ApproveSubmissionDto extends createZodDto(
  z.object({ note: z.string().max(1000).optional() }),
) {}

@ApiTags('view-tracking')
@ApiBearerAuth()
@RequirePermission(Permission.CampaignManage)
@Controller('submissions/:submissionId')
export class ApprovalPayoutController {
  constructor(private readonly approvals: ApprovalPayoutService) {}

  /** Current views on every channel and what approving would pay now. */
  @Get('payout-preview')
  preview(
    @CurrentUser() principal: Principal,
    @Param('submissionId', ParseUUIDPipe) submissionId: string,
  ): Promise<PayoutPreview> {
    return this.approvals.preview(submissionId, principal.userId);
  }

  /** Approves and pays the creator for the views so far. */
  @HttpCode(HttpStatus.OK)
  @Post('approve')
  approve(
    @CurrentUser() principal: Principal,
    @Param('submissionId', ParseUUIDPipe) submissionId: string,
    @Body() dto: ApproveSubmissionDto,
  ): Promise<ApprovalResult> {
    return this.approvals.approveAndPay(submissionId, principal.userId, dto.note);
  }

  /** Pays an approved creator for views gained since they were last paid. */
  @HttpCode(HttpStatus.OK)
  @Post('pay')
  pay(
    @CurrentUser() principal: Principal,
    @Param('submissionId', ParseUUIDPipe) submissionId: string,
  ): Promise<ApprovalResult> {
    return this.approvals.payForNewViews(submissionId, principal.userId);
  }
}
