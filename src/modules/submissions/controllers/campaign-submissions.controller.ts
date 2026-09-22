import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Submission } from '@prisma/client';
import { CurrentUser, Principal } from '@platform/auth';
import { Permission, RequirePermission } from '@platform/rbac';
import { SubmitContentDto } from '../dto/submit-content.dto';
import { SubmissionService, SubmissionWithRevisions } from '../services/submission.service';

@ApiTags('submissions')
@ApiBearerAuth()
@Controller('campaigns/:campaignId/submissions')
export class CampaignSubmissionsController {
  constructor(private readonly submissions: SubmissionService) {}

  @RequirePermission(Permission.ContentSubmit)
  @Post()
  submit(
    @CurrentUser() principal: Principal,
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Body() dto: SubmitContentDto,
  ): Promise<SubmissionWithRevisions> {
    return this.submissions.submit(campaignId, principal.userId, dto);
  }

  @RequirePermission(Permission.CampaignManage)
  @Get()
  list(
    @CurrentUser() principal: Principal,
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
  ): Promise<Submission[]> {
    return this.submissions.listForCampaign(campaignId, principal.userId);
  }
}
