import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '@platform/database/prisma.service';
import { LlmConfig } from '../llm/llm-config';
import { ProviderRegistry } from '../llm/provider-registry';
import { FakeProvider } from '../testing/fake-provider';
import { AiSettingsService } from './ai-settings.service';

const config: LlmConfig = {
  defaultProvider: 'ollama',
  requestTimeoutMs: 1000,
  runTimeoutMs: 5000,
  maxRetries: 0,
  contextTokens: 4096,
  maxOutputTokens: 512,
  ollama: { baseUrl: 'http://ollama.test', model: 'gpt-oss:20b' },
  anthropic: { model: 'claude-opus-5-5' },
};

function setup(saved: { provider: string; model: string } | null = null) {
  const prisma = {
    aiSetting: {
      findUnique: jest.fn().mockResolvedValue(saved),
      upsert: jest.fn().mockResolvedValue(undefined),
      deleteMany: jest.fn().mockResolvedValue(undefined),
    },
  };
  const registry = new ProviderRegistry([
    new FakeProvider([], 'ollama', [{ name: 'gpt-oss:20b' }, { name: 'llama3.2:1b' }]),
  ]);
  const service = new AiSettingsService(prisma as unknown as PrismaService, config, registry);
  return { service, prisma };
}

describe('AiSettingsService', () => {
  it('uses the environment default when staff saved nothing', async () => {
    const { service } = setup();

    await expect(service.view()).resolves.toMatchObject({
      active: { provider: 'ollama', model: 'gpt-oss:20b' },
      source: 'environment',
      providers: [{ id: 'ollama', configured: true, defaultModel: 'gpt-oss:20b' }],
    });
  });

  it('prefers the staff choice once saved', async () => {
    const { service } = setup({ provider: 'ollama', model: 'llama3.2:1b' });

    await expect(service.active()).resolves.toEqual({ provider: 'ollama', model: 'llama3.2:1b' });
  });

  it('saves a model the provider offers', async () => {
    const { service, prisma } = setup();

    await service.update('ollama', 'llama3.2:1b', 'staff-1');

    expect(prisma.aiSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: {
          key: 'default',
          provider: 'ollama',
          model: 'llama3.2:1b',
          updatedByStaffId: 'staff-1',
        },
      }),
    );
  });

  it('rejects a model the provider does not offer', async () => {
    const { service, prisma } = setup();

    await expect(service.update('ollama', 'nope', 'staff-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.aiSetting.upsert).not.toHaveBeenCalled();
  });

  it('rejects a provider that is not configured', async () => {
    const { service } = setup();

    await expect(service.update('anthropic', 'claude-opus-5-5', 'staff-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
