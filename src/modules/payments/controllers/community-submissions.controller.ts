import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Principal } from '@platform/auth';
import {
  CommunitySubmissionsService,
  CommunitySubmissionView,
} from '../application/community-submissions.service';

@ApiTags('submissions')
@ApiBearerAuth()
@Controller('campaigns/:campaignId/community-submissions')
export class CommunitySubmissionsController {
  constructor(private readonly community: CommunitySubmissionsService) {}

  /** Approved posts on a campaign, for anyone who may see that campaign. */
  @Get()
  list(
    @CurrentUser() principal: Principal,
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
  ): Promise<CommunitySubmissionView[]> {
    return this.community.list(campaignId, principal.userId);
  }
}
