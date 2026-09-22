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
import { Submission } from '@prisma/client';
import { CurrentUser, Principal } from '@platform/auth';
import { Permission, RequirePermission } from '@platform/rbac';
import { ReviewSubmissionDto } from '../dto/review-submission.dto';
import { SubmitContentDto } from '../dto/submit-content.dto';
import { ReviewService } from '../services/review.service';
import {
  SubmissionDetail,
  SubmissionService,
  SubmissionWithRevisions,
} from '../services/submission.service';

@ApiTags('submissions')
@ApiBearerAuth()
@Controller('submissions')
export class SubmissionsController {
  constructor(
    private readonly submissions: SubmissionService,
    private readonly reviews: ReviewService,
  ) {}

  @Get(':submissionId')
  get(
    @CurrentUser() principal: Principal,
    @Param('submissionId', ParseUUIDPipe) submissionId: string,
  ): Promise<SubmissionDetail> {
    return this.submissions.getById(submissionId, principal.userId);
  }

  @RequirePermission(Permission.ContentSubmit)
  @Post(':submissionId/revisions')
  resubmit(
    @CurrentUser() principal: Principal,
    @Param('submissionId', ParseUUIDPipe) submissionId: string,
    @Body() dto: SubmitContentDto,
  ): Promise<SubmissionWithRevisions> {
    return this.submissions.resubmit(submissionId, principal.userId, dto);
  }

  @RequirePermission(Permission.CampaignManage)
  @HttpCode(HttpStatus.OK)
  @Post(':submissionId/review')
  review(
    @CurrentUser() principal: Principal,
    @Param('submissionId', ParseUUIDPipe) submissionId: string,
    @Body() dto: ReviewSubmissionDto,
  ): Promise<Submission> {
    return this.reviews.review(submissionId, principal.userId, dto);
  }
}
