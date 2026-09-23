import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Principal } from '@platform/auth';
import { Permission, RequirePermission } from '@platform/rbac';
import { CampaignBriefDto, ContentIdeasDto } from '../dto/ai.dto';
import { AiAssistantService, AiResult } from '../services/ai-assistant.service';

@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai')
export class AiController {
  constructor(private readonly assistant: AiAssistantService) {}

  @RequirePermission(Permission.CampaignManage)
  @HttpCode(HttpStatus.OK)
  @Post('campaign-brief')
  campaignBrief(
    @CurrentUser() principal: Principal,
    @Body() dto: CampaignBriefDto,
  ): Promise<AiResult> {
    return this.assistant.draftCampaignBrief(principal.userId, dto.idea);
  }

  @RequirePermission(Permission.CreatorProfileManage)
  @HttpCode(HttpStatus.OK)
  @Post('content-ideas')
  contentIdeas(
    @CurrentUser() principal: Principal,
    @Body() dto: ContentIdeasDto,
  ): Promise<AiResult> {
    return this.assistant.suggestContentIdeas(principal.userId, dto.topic);
  }
}
