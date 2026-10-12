import { Body, Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Principal } from '@platform/auth';
import { Permission, RequirePermission } from '@platform/rbac';
import { TrackingResult, ViewTrackingService } from '../application/view-tracking.service';
import { ManualViewsDto } from '../dto/view-tracking.dto';

@ApiTags('view-tracking')
@ApiBearerAuth()
@RequirePermission(Permission.CampaignManage)
@Controller()
export class ViewTrackingController {
  constructor(private readonly tracking: ViewTrackingService) {}

  @HttpCode(HttpStatus.OK)
  @Post('submissions/:submissionId/views')
  recordManual(
    @CurrentUser() principal: Principal,
    @Param('submissionId', ParseUUIDPipe) submissionId: string,
    @Body() dto: ManualViewsDto,
  ): Promise<TrackingResult> {
    return this.tracking.recordManualViews(submissionId, principal.userId, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('submissions/:submissionId/views/sync')
  syncSubmission(
    @CurrentUser() principal: Principal,
    @Param('submissionId', ParseUUIDPipe) submissionId: string,
  ): Promise<TrackingResult> {
    return this.tracking.syncSubmission(submissionId, principal.userId);
  }

  @HttpCode(HttpStatus.OK)
  @Post('campaigns/:campaignId/views/sync')
  syncCampaign(
    @CurrentUser() principal: Principal,
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
  ): Promise<TrackingResult> {
    return this.tracking.syncCampaign(campaignId, principal.userId);
  }
}
