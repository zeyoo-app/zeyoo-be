import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Campaign, CampaignStatus, CampaignVisibility } from '@prisma/client';
import { PrismaService } from '@platform/database/prisma.service';
import { EntitlementsService, type PlanEntitlements } from '@modules/entitlements/entitlements.public';
import { OrganizationService } from '@modules/iam/iam.public';
import { CampaignService } from './campaign.service';
import { CategoryService } from './category.service';

interface Mocks {
  findUnique: jest.Mock;
  isMember: jest.Mock;
  assertMember: jest.Mock;
  findInvitation: jest.Mock;
  fundedSum: jest.Mock;
  liveCount: jest.Mock;
  plan: jest.Mock;
}

function buildCampaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: 'campaign-1',
    organizationId: 'org-1',
    createdByUserId: 'user-1',
    categoryId: null,
    title: 'Launch',
    description: 'A campaign',
    goals: null,
    audience: null,
    guidelines: null,
    hashtags: [],
    mentions: [],
    referenceMaterials: [],
    coverImageUrl: null,
    platform: 'TIKTOK',
    platforms: ['TIKTOK'],
    contentType: 'UGC',
    visibility: 'PRIVATE' as CampaignVisibility,
    status: 'DRAFT' as CampaignStatus,
    startDate: new Date('2026-01-01'),
    endDate: new Date('2026-02-01'),
    currencyCode: 'USD',
    budgetAmount: 100_000,
    rewardType: 'FIXED_PER_ITEM',
    rewardAmount: 5_000,
    maxRewardPerCreatorAmount: null,
    publishedAt: null,
    closedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const STARTER: PlanEntitlements = {
  planKey: 'starter',
  maxActiveCampaigns: 1,
  platformFeeBps: 1000,
  allowsPrivateCampaigns: false,
};

function setup(campaign: Campaign): { service: CampaignService; mocks: Mocks } {
  const mocks: Mocks = {
    findUnique: jest.fn().mockResolvedValue(campaign),
    isMember: jest.fn(),
    assertMember: jest.fn().mockResolvedValue(undefined),
    findInvitation: jest.fn().mockResolvedValue(null),
    fundedSum: jest.fn().mockResolvedValue({ _sum: { amount: campaign.budgetAmount } }),
    liveCount: jest.fn().mockResolvedValue(0),
    plan: jest.fn().mockResolvedValue(STARTER),
  };
  const prisma = {
    campaign: {
      findUnique: mocks.findUnique,
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...campaign, ...data })),
      count: mocks.liveCount,
    },
    campaignInvitation: { findFirst: mocks.findInvitation },
    campaignFunding: { aggregate: mocks.fundedSum },
    campaignRefund: { aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null } }) },
  } as unknown as PrismaService;
  const organizations = {
    isMember: mocks.isMember,
    assertMember: mocks.assertMember,
  } as unknown as OrganizationService;
  const categories = { assertExists: jest.fn() } as unknown as CategoryService;
  const entitlements = { forOrganization: mocks.plan } as unknown as EntitlementsService;
  return { service: new CampaignService(prisma, organizations, categories, entitlements), mocks };
}

describe('CampaignService lifecycle guards', () => {
  it('rejects publishing a campaign that is not a draft', async () => {
    const { service } = setup(buildCampaign({ status: 'PUBLISHED' }));

    await expect(service.publish('campaign-1', 'user-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects closing a campaign that is not published', async () => {
    const { service } = setup(buildCampaign({ status: 'DRAFT' }));

    await expect(service.close('campaign-1', 'user-1')).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('CampaignService.publish', () => {
  const draft = (): Campaign => buildCampaign({ visibility: 'PUBLIC' });

  it('publishes a fully funded draft within the plan', async () => {
    const { service } = setup(draft());

    await expect(service.publish('campaign-1', 'user-1')).resolves.toMatchObject({
      status: 'PUBLISHED',
    });
  });

  it('refuses a campaign whose budget has not been paid', async () => {
    const { service, mocks } = setup(draft());
    mocks.fundedSum.mockResolvedValue({ _sum: { amount: null } });

    await expect(service.publish('campaign-1', 'user-1')).rejects.toThrow(
      'Fund the campaign budget before publishing it.',
    );
  });

  it('refuses a partly funded campaign', async () => {
    const { service, mocks } = setup(draft());
    mocks.fundedSum.mockResolvedValue({ _sum: { amount: 40_000 } });

    await expect(service.publish('campaign-1', 'user-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses going over the plan live-campaign limit', async () => {
    const { service, mocks } = setup(draft());
    mocks.liveCount.mockResolvedValue(1);

    await expect(service.publish('campaign-1', 'user-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('allows unlimited live campaigns on a plan without a limit', async () => {
    const { service, mocks } = setup(draft());
    mocks.liveCount.mockResolvedValue(40);
    mocks.plan.mockResolvedValue({ ...STARTER, maxActiveCampaigns: null });

    await expect(service.publish('campaign-1', 'user-1')).resolves.toBeDefined();
  });

  it('refuses an invite-only campaign on a plan without them', async () => {
    const { service } = setup(buildCampaign({ visibility: 'PRIVATE' }));

    await expect(service.publish('campaign-1', 'user-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('CampaignService.getById visibility', () => {
  it('returns the campaign to an organization member', async () => {
    const { service, mocks } = setup(buildCampaign());
    mocks.isMember.mockResolvedValue(true);

    await expect(service.getById('campaign-1', 'member')).resolves.toBeDefined();
  });

  it('hides a private campaign from a non-member', async () => {
    const { service, mocks } = setup(buildCampaign({ visibility: 'PRIVATE' }));
    mocks.isMember.mockResolvedValue(false);

    await expect(service.getById('campaign-1', 'outsider')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('shows a published public campaign to a non-member', async () => {
    const { service, mocks } = setup(buildCampaign({ status: 'PUBLISHED', visibility: 'PUBLIC' }));
    mocks.isMember.mockResolvedValue(false);

    await expect(service.getById('campaign-1', 'outsider')).resolves.toBeDefined();
  });

  it('shows a published invite-only campaign to an invited creator', async () => {
    const { service, mocks } = setup(buildCampaign({ status: 'PUBLISHED', visibility: 'PRIVATE' }));
    mocks.isMember.mockResolvedValue(false);
    mocks.findInvitation.mockResolvedValue({ id: 'invitation-1' });

    await expect(service.getById('campaign-1', 'invited-creator')).resolves.toBeDefined();
  });

  it('hides a published invite-only campaign from a creator who was not invited', async () => {
    const { service, mocks } = setup(buildCampaign({ status: 'PUBLISHED', visibility: 'PRIVATE' }));
    mocks.isMember.mockResolvedValue(false);

    await expect(service.getById('campaign-1', 'outsider')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('CampaignService.update on a live campaign', () => {
  const live = buildCampaign({ status: 'PUBLISHED' });

  it('lets the brand correct the wording and extend the end date', async () => {
    const { service } = setup(live);

    const updated = await service.update('campaign-1', 'user-1', {
      description: 'Clearer brief',
      goals: 'Awareness',
      endDate: new Date('2026-03-01'),
    });

    expect(updated.description).toBe('Clearer brief');
    expect(updated.endDate).toEqual(new Date('2026-03-01'));
  });

  it('keeps the money and reward terms creators applied on', async () => {
    const { service } = setup(live);

    await expect(
      service.update('campaign-1', 'user-1', { rewardAmount: 1, budgetAmount: 10 }),
    ).rejects.toThrow("A live campaign's terms cannot change (rewardAmount, budgetAmount)");
  });

  it('does not let the end date move earlier', async () => {
    const { service } = setup(live);

    await expect(
      service.update('campaign-1', 'user-1', { endDate: new Date('2026-01-15') }),
    ).rejects.toThrow('extended, not shortened');
  });

  it('refuses edits once the campaign is closed', async () => {
    const { service } = setup(buildCampaign({ status: 'CLOSED' }));

    await expect(service.update('campaign-1', 'user-1', { title: 'New' })).rejects.toThrow(
      'closed campaign',
    );
  });
});
