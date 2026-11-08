import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiProduces, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { CurrentUser, Principal } from '@platform/auth';
import { Permission, RequirePermission } from '@platform/rbac';
import {
  CampaignBriefDto,
  CampaignBriefResultDto,
  ContentIdeasDto,
  ContentIdeasResultDto,
} from '../dto/ai.dto';
import { CampaignBriefDraft } from '../prompts/campaign-brief.v1';
import { ContentIdeas } from '../prompts/content-ideas.v1';
import { toHttpException } from '../services/ai-errors';
import { AiAssistantService, AiResult } from '../services/ai-assistant.service';
import { abortOnDisconnect, streamAssistant } from './sse';

/**
 * Each assistant has a JSON endpoint (one response when done) and a `/stream`
 * endpoint (server-sent events with progress and partial results).
 */
@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai')
export class AiController {
  constructor(private readonly assistant: AiAssistantService) {}

  @RequirePermission(Permission.CampaignManage)
  @HttpCode(HttpStatus.OK)
  @Post('campaign-brief')
  @ApiOkResponse({ type: CampaignBriefResultDto })
  async campaignBrief(
    @CurrentUser() principal: Principal,
    @Body() dto: CampaignBriefDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AiResult<CampaignBriefDraft>> {
    try {
      return await this.assistant.draftCampaignBrief(principal.userId, dto, {
        signal: abortOnDisconnect(response),
      });
    } catch (error) {
      throw toHttpException(error);
    }
  }

  @RequirePermission(Permission.CampaignManage)
  @Post('campaign-brief/stream')
  @ApiProduces('text/event-stream')
  campaignBriefStream(
    @CurrentUser() principal: Principal,
    @Body() dto: CampaignBriefDto,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    return streamAssistant(request, response, (options) =>
      this.assistant.draftCampaignBrief(principal.userId, dto, options),
    );
  }

  @RequirePermission(Permission.CreatorProfileManage)
  @HttpCode(HttpStatus.OK)
  @Post('content-ideas')
  @ApiOkResponse({ type: ContentIdeasResultDto })
  async contentIdeas(
    @CurrentUser() principal: Principal,
    @Body() dto: ContentIdeasDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AiResult<ContentIdeas>> {
    const context = await this.assistant.prepareContentIdeas(principal.userId, dto);
    try {
      return await this.assistant.suggestContentIdeas(principal.userId, context, {
        signal: abortOnDisconnect(response),
      });
    } catch (error) {
      throw toHttpException(error);
    }
  }

  @RequirePermission(Permission.CreatorProfileManage)
  @Post('content-ideas/stream')
  @ApiProduces('text/event-stream')
  async contentIdeasStream(
    @CurrentUser() principal: Principal,
    @Body() dto: ContentIdeasDto,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const context = await this.assistant.prepareContentIdeas(principal.userId, dto);
    return streamAssistant(request, response, (options) =>
      this.assistant.suggestContentIdeas(principal.userId, context, options),
    );
  }
}
