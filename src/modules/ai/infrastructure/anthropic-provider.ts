import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '@platform/config/env.schema';
import { AiGenerateInput, AiProviderPort } from '../ports/ai-provider.port';

const MESSAGES_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-5';
const MAX_TOKENS = 1024;

interface AnthropicResponse {
  content: { text: string }[];
}

@Injectable()
export class AnthropicProvider implements AiProviderPort {
  private readonly apiKey: string | undefined;

  constructor(config: ConfigService<Env, true>) {
    this.apiKey = config.get('ANTHROPIC_API_KEY', { infer: true });
  }

  async generate(input: AiGenerateInput): Promise<string> {
    if (!this.apiKey) {
      throw new ServiceUnavailableException('AI features are not configured.');
    }
    const response = await fetch(MESSAGES_ENDPOINT, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: input.system,
        messages: [{ role: 'user', content: input.prompt }],
      }),
    });
    if (!response.ok) {
      throw new ServiceUnavailableException('The AI provider is currently unavailable.');
    }
    const data = (await response.json()) as AnthropicResponse;
    return data.content.map((block) => block.text).join('\n');
  }
}
