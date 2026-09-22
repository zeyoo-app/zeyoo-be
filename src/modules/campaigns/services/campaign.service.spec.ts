import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Campaign, CampaignStatus, CampaignVisibility } from '@prisma/client';
import { PrismaService } from '@platform/database/prisma.service';
import { OrganizationService } from '@modules/iam/iam.public';
import { CampaignService } from './campaign.service';
import { CategoryService } from './category.service';

interface Mocks {
  findUnique: jest.Mock;
  isMember: jest.Mock;
  assertMember: jest.Mock;
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
    platform: 'TIKTOK',
    visibility: 'PRIVATE' as CampaignVisibility,
    status: 'DRAFT' as CampaignStatus,
    startDate: new Date('2026-01-01'),
    endDate: new Date('2026-02-01'),
    currencyCode: 'USD',
    budgetAmount: 100_000,
    rewardType: 'FIXED_PER_ITEM',
    rewardAmount: 5_000,
    publishedAt: null,
    closedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function setup(campaign: Campaign): { service: CampaignService; mocks: Mocks } {
  const mocks: Mocks = {
    findUnique: jest.fn().mockResolvedValue(campaign),
    isMember: jest.fn(),
    assertMember: jest.fn().mockResolvedValue(undefined),
  };
  const prisma = { campaign: { findUnique: mocks.findUnique } } as unknown as PrismaService;
  const organizations = {
    isMember: mocks.isMember,
    assertMember: mocks.assertMember,
  } as unknown as OrganizationService;
  const categories = { assertExists: jest.fn() } as unknown as CategoryService;
  return { service: new CampaignService(prisma, organizations, categories), mocks };
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
});
