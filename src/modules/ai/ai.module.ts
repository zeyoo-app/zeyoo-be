import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CampaignsModule } from '@modules/campaigns/campaigns.public';
import { CreatorsModule } from '@modules/creators/creators.public';
import { Env } from '@platform/config/env.schema';
import { AgentRunner } from './agent/agent-runner';
import { CONTEXT_BUILDER, ContextBuilder } from './context/context-builder';
import { AdminAiController } from './controllers/admin-ai.controller';
import { AiController } from './controllers/ai.controller';
import { LLM_CONFIG, LLM_ENV_KEYS, LlmConfig, llmConfigFromEnv, LlmEnv } from './llm/llm-config';
import { LLM_PROVIDERS, ProviderRegistry } from './llm/provider-registry';
import { AiAssistantService } from './services/ai-assistant.service';
import { AiSettingsService } from './services/ai-settings.service';

@Module({
  imports: [CampaignsModule, CreatorsModule],
  controllers: [AiController, AdminAiController],
  providers: [
    {
      provide: LLM_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): LlmConfig =>
        llmConfigFromEnv(
          Object.fromEntries(
            LLM_ENV_KEYS.map((key) => [key, config.get(key, { infer: true })]),
          ) as LlmEnv,
        ),
    },
    {
      provide: LLM_PROVIDERS,
      inject: [LLM_CONFIG],
      useFactory: (config: LlmConfig) => ProviderRegistry.fromConfig(config),
    },
    {
      provide: CONTEXT_BUILDER,
      inject: [LLM_CONFIG],
      useFactory: (config: LlmConfig) =>
        new ContextBuilder({
          contextTokens: config.contextTokens,
          reserveOutputTokens: config.maxOutputTokens,
        }),
    },
    {
      provide: AgentRunner,
      inject: [CONTEXT_BUILDER],
      useFactory: (context: ContextBuilder) => new AgentRunner(context),
    },
    AiSettingsService,
    AiAssistantService,
  ],
})
export class AiModule {}
