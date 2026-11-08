import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CampaignService } from '@modules/campaigns/campaigns.public';
import { CreatorProfileService } from '@modules/creators/creators.public';
import { PrismaService } from '@platform/database/prisma.service';
import { AgentRunner } from '../agent/agent-runner';
import { ContextBuilder } from '../context/context-builder';
import { LlmConfig } from '../llm/llm-config';
import { LlmError } from '../llm/llm.types';
import { ProviderRegistry } from '../llm/provider-registry';
import { FakeProvider, ScriptedReply } from '../testing/fake-provider';
import { AiAssistantService } from './ai-assistant.service';
import { AiSettingsService } from './ai-settings.service';

const config: LlmConfig = {
  defaultProvider: 'ollama',
  requestTimeoutMs: 1000,
  runTimeoutMs: 5000,
  maxRetries: 0,
  contextTokens: 8000,
  maxOutputTokens: 1000,
  ollama: { baseUrl: 'http://ollama.test', model: 'fake-model' },
  anthropic: { model: 'claude-opus-5-5' },
};

const campaign = {
  id: 'c1',
  title: 'Summer Glow',
  description: 'Show the serum in morning routines. '.repeat(100),
  goals: 'Drive trial',
  audience: null,
  guidelines: 'Show the bottle in the first 3 seconds',
  hashtags: ['#GlowWithNimbus'],
  platform: 'TIKTOK',
  platforms: ['TIKTOK', 'INSTAGRAM'],
  contentType: 'UGC',
};

const brief = {
  brief:
    'Film your morning routine and show how the serum fits in, with a close-up of the texture.',
  goals: 'Get people to try the serum.',
  audience: 'Women 18-30 into skincare.',
  contentRules: ['Show the bottle early', 'Say how it feels'],
  hashtags: ['glow up', '#Nimbus', 'Nimbus'],
};

function setup(replies: ScriptedReply[]) {
  const provider = new FakeProvider(replies);
  const prisma = {
    aiRequest: { create: jest.fn().mockResolvedValue(undefined) },
    membership: {
      findFirst: jest.fn().mockResolvedValue({ organization: { name: 'Nimbus Skincare' } }),
    },
  };
  const settings = {
    active: jest.fn().mockResolvedValue({ provider: 'ollama', model: 'fake-model' }),
  } as unknown as AiSettingsService;
  const campaigns = { getById: jest.fn().mockResolvedValue(campaign) };
  const creators = {
    getPublicByUserId: jest.fn().mockResolvedValue({
      displayName: 'Sara',
      headline: 'Skincare reviews',
      bio: 'I test serums',
    }),
  };
  const context = new ContextBuilder({ contextTokens: 8000, reserveOutputTokens: 1000 });
  const service = new AiAssistantService(
    prisma as unknown as PrismaService,
    settings,
    campaigns as unknown as CampaignService,
    creators as unknown as CreatorProfileService,
    new AgentRunner(context),
    context,
    new ProviderRegistry([provider]),
    config,
  );
  return { service, provider, prisma, campaigns, creators };
}

const run = { signal: new AbortController().signal };

describe('AiAssistantService', () => {
  it('drafts a brief, normalizes hashtags and logs the request', async () => {
    const { service, provider, prisma } = setup([{ text: JSON.stringify(brief) }]);

    const result = await service.draftCampaignBrief(
      'user-1',
      { idea: 'Nimbus glow serum', platforms: ['TIKTOK'], contentType: 'UGC', language: 'en' },
      run,
    );

    expect(result.data.hashtags).toEqual(['#glow_up', '#Nimbus']);
    expect(result.meta).toMatchObject({
      provider: 'ollama',
      model: 'fake-model',
      promptVersion: 'campaign-brief@v1',
    });
    expect(provider.requests[0].responseSchema).toMatchObject({
      type: 'object',
      required: expect.arrayContaining(['brief', 'hashtags']),
    });
    expect(provider.requests[0].messages[1].content).toContain('Nimbus glow serum');
    expect(provider.requests[0].messages[1].content).toContain('Brand: Nimbus Skincare');
    expect(prisma.aiRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        kind: 'campaign-brief',
        status: 'SUCCEEDED',
        inputTokens: 10,
        outputTokens: 20,
      }),
    });
  });

  it('logs a failed run with its error code and rethrows', async () => {
    const { service, prisma } = setup([{ error: new LlmError('BILLING', 'no credits') }]);

    await expect(
      service.draftCampaignBrief(
        'user-1',
        { idea: 'Serum', platforms: [], contentType: 'UGC', language: 'en' },
        run,
      ),
    ).rejects.toMatchObject({ code: 'BILLING' });
    expect(prisma.aiRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'FAILED', errorCode: 'AI_BILLING', response: null }),
    });
  });

  it('builds content-idea context from the campaign and creator, clipping long text', async () => {
    const { service } = setup([]);

    const context = await service.prepareContentIdeas('creator-1', {
      campaignId: 'c1',
      focus: 'comedy',
      language: 'ar',
    });

    expect(context.campaign.brief.length).toBeLessThanOrEqual(2001);
    expect(context.campaign.brief.endsWith('…')).toBe(true);
    expect(context.campaign.platforms).toEqual(['TIKTOK', 'INSTAGRAM']);
    expect(context.creator).toEqual({
      displayName: 'Sara',
      headline: 'Skincare reviews',
      bio: 'I test serums',
    });
    expect(context).toMatchObject({ focus: 'comedy', language: 'ar' });
  });

  it('works for creators without a profile yet', async () => {
    const { service, creators } = setup([]);
    creators.getPublicByUserId.mockRejectedValue(new NotFoundException());

    const context = await service.prepareContentIdeas('creator-1', {
      campaignId: 'c1',
      language: 'en',
    });

    expect(context.creator).toBeUndefined();
  });

  it('refuses ideas for a campaign the creator cannot see', async () => {
    const { service, campaigns } = setup([]);
    campaigns.getById.mockRejectedValue(new ForbiddenException());

    await expect(
      service.prepareContentIdeas('creator-1', { campaignId: 'c1', language: 'en' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns three validated ideas', async () => {
    const idea = {
      title: 'Morning routine',
      hook: 'My 6am secret',
      talkingPoints: ['Texture close-up', 'How it feels'],
      format: '30-second talking head',
    };
    const { service } = setup([{ text: JSON.stringify({ ideas: [idea, idea, idea] }) }]);
    const context = await service.prepareContentIdeas('creator-1', {
      campaignId: 'c1',
      language: 'en',
    });

    const result = await service.suggestContentIdeas('creator-1', context, run);

    expect(result.data.ideas).toHaveLength(3);
    expect(result.meta.promptVersion).toBe('content-ideas@v1');
  });

  it("tells the model the campaign is the brand's, not Zeyoo's", async () => {
    const { service, provider } = setup([{ text: JSON.stringify(brief) }]);

    await service.draftCampaignBrief(
      'user-1',
      { idea: 'Nimbus glow serum', platforms: [], contentType: 'UGC', language: 'en' },
      run,
    );

    const [system] = provider.requests[0].messages;
    expect(system.content).toContain('never present Zeyoo as the company behind the product');
    expect(system.content).not.toContain('strategist at Zeyoo');
  });

  it('still drafts a brief when the user has no organization', async () => {
    const { service, provider, prisma } = setup([{ text: JSON.stringify(brief) }]);
    prisma.membership.findFirst.mockResolvedValue(null);

    await service.draftCampaignBrief(
      'user-1',
      { idea: 'Nimbus glow serum', platforms: [], contentType: 'UGC', language: 'en' },
      run,
    );

    expect(provider.requests[0].messages[1].content).not.toContain('Brand:');
  });
});
