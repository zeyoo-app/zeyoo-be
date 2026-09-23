import { Module } from '@nestjs/common';
import { AiController } from './controllers/ai.controller';
import { AnthropicProvider } from './infrastructure/anthropic-provider';
import { AI_PROVIDER } from './ports/ai-provider.port';
import { AiAssistantService } from './services/ai-assistant.service';

@Module({
  controllers: [AiController],
  providers: [AiAssistantService, { provide: AI_PROVIDER, useClass: AnthropicProvider }],
})
export class AiModule {}
