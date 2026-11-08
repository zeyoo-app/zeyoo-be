import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Principal } from '@platform/auth';
import { Permission, RequirePermission } from '@platform/rbac';
import { UpdateAiSettingsDto, updateAiSettingsSchema } from '../dto/ai.dto';
import { LlmError, LlmProviderId, ModelInfo } from '../llm/llm.types';
import { LLM_PROVIDERS, ProviderRegistry } from '../llm/provider-registry';
import { describeAiFailure, toHttpException } from '../services/ai-errors';
import { AiSettingsService, AiSettingsView } from '../services/ai-settings.service';

export interface AiConnectionTest {
  ok: boolean;
  provider: string;
  model: string;
  latencyMs: number;
  reply?: string;
  error?: { code: string; message: string };
}

const PROVIDER_IDS = updateAiSettingsSchema.shape.provider;

/** Back-office control of which provider and model the assistants use. */
@ApiTags('admin')
@ApiBearerAuth()
@RequirePermission(Permission.AdminAccess)
@Controller('admin/ai')
export class AdminAiController {
  constructor(
    private readonly settings: AiSettingsService,
    @Inject(LLM_PROVIDERS) private readonly registry: ProviderRegistry,
  ) {}

  @Get('settings')
  view(): Promise<AiSettingsView> {
    return this.settings.view();
  }

  @Get('providers/:provider/models')
  async models(@Param('provider') provider: string): Promise<ModelInfo[]> {
    try {
      return await this.settings.models(PROVIDER_IDS.parse(provider));
    } catch (error) {
      throw toHttpException(
        error instanceof LlmError ? error : new LlmError('BAD_REQUEST', 'Unknown provider.'),
      );
    }
  }

  @HttpCode(HttpStatus.OK)
  @Post('settings')
  update(
    @CurrentUser() principal: Principal,
    @Body() dto: UpdateAiSettingsDto,
  ): Promise<AiSettingsView> {
    return this.settings.update(dto.provider, dto.model, principal.userId);
  }

  @HttpCode(HttpStatus.OK)
  @Post('settings/reset')
  reset(): Promise<AiSettingsView> {
    return this.settings.reset();
  }

  /** Sends a one-line prompt through the active provider and model. */
  @HttpCode(HttpStatus.OK)
  @Post('test')
  async test(): Promise<AiConnectionTest> {
    const active = await this.settings.active();
    const startedAt = Date.now();
    try {
      const result = await this.registry.get(active.provider as LlmProviderId).chat({
        model: active.model,
        messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
        maxOutputTokens: 256,
      });
      return {
        ok: true,
        provider: active.provider,
        model: result.model,
        latencyMs: Date.now() - startedAt,
        reply: result.content.trim().slice(0, 200),
      };
    } catch (error) {
      // Staff see the provider's own explanation (e.g. "no usage credits").
      const failure = describeAiFailure(error);
      return {
        ok: false,
        provider: active.provider,
        model: active.model,
        latencyMs: Date.now() - startedAt,
        error: {
          code: failure.code,
          message: error instanceof Error ? error.message : failure.message,
        },
      };
    }
  }
}
