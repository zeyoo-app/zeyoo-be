import { EarningsSettlementService } from './earnings-settlement.service';

const CAMPAIGN = {
  id: 'campaign-1',
  organizationId: 'organization-1',
  currencyCode: 'USD',
  budgetAmount: 100_000,
  rewardType: 'PER_VIEW',
  rewardAmount: 500, // per 1,000 views
  maxRewardPerCreatorAmount: null as number | null,
};

interface Setup {
  approvedCreators?: string[];
  views?: Record<string, number>;
  fundedMinor?: number;
  accrued?: Record<string, number>;
  campaign?: Partial<typeof CAMPAIGN>;
  pausedCreators?: string[];
}

function build({
  approvedCreators = ['creator-1'],
  views = {},
  fundedMinor = 100_000,
  accrued = {},
  campaign = {},
  pausedCreators = [],
}: Setup = {}): {
  service: EarningsSettlementService;
  ledger: { recordEarning: jest.Mock };
  earnings: Map<string, number>;
} {
  const earnings = new Map(Object.entries(accrued));
  const prisma = {
    creatorEarning: {
      findMany: jest
        .fn()
        .mockImplementation(async () =>
          [...earnings].map(([creatorUserId, accruedAmount]) => ({ creatorUserId, accruedAmount })),
        ),
      updateMany: jest.fn().mockImplementation(async ({ where, data }) => {
        if (earnings.get(where.creatorUserId) !== where.accruedAmount) return { count: 0 };
        earnings.set(where.creatorUserId, data.accruedAmount);
        return { count: 1 };
      }),
      create: jest.fn().mockImplementation(async ({ data }) => {
        earnings.set(data.creatorUserId, data.accruedAmount);
      }),
    },
  };
  const ledger = { recordEarning: jest.fn().mockResolvedValue(undefined) };
  const service = new EarningsSettlementService(
    prisma as never,
    { requireCampaign: jest.fn().mockResolvedValue({ ...CAMPAIGN, ...campaign }) } as never,
    { assertMember: jest.fn().mockResolvedValue(undefined) } as never,
    { approvedCreatorIds: jest.fn().mockResolvedValue(approvedCreators) } as never,
    {
      latestViewsByCreator: jest.fn().mockResolvedValue(new Map(Object.entries(views))),
    } as never,
    { totalSucceededMinor: jest.fn().mockResolvedValue(fundedMinor) } as never,
    ledger as never,
    { notify: jest.fn().mockResolvedValue(undefined) } as never,
    {
      pausedCreatorIds: jest.fn().mockResolvedValue(new Set(pausedCreators)),
      pausedCampaignIds: jest.fn().mockResolvedValue(new Set()),
    } as never,
  );
  return { service, ledger, earnings };
}

describe('EarningsSettlementService', () => {
  it('credits an approved creator for their views', async () => {
    const { service, ledger } = build({ views: { 'creator-1': 20_000 } });

    const summary = await service.settleCampaign('campaign-1', 'brand-user');

    expect(ledger.recordEarning).toHaveBeenCalledWith(
      'organization-1',
      'creator-1',
      expect.objectContaining({ amountMinor: 10_000 }),
      'earning:campaign-1:creator-1:10000',
    );
    expect(summary.totalAccruedMinor).toBe(10_000);
    expect(summary.budgetRemainingMinor).toBe(90_000);
  });

  it('credits only the increase since the previous settlement', async () => {
    const { service, ledger } = build({
      views: { 'creator-1': 30_000 },
      accrued: { 'creator-1': 10_000 },
    });

    const summary = await service.settleCampaign('campaign-1', 'brand-user');

    expect(ledger.recordEarning).toHaveBeenCalledWith(
      'organization-1',
      'creator-1',
      expect.objectContaining({ amountMinor: 5_000 }),
      expect.any(String),
    );
    expect(summary.creators[0]).toMatchObject({ accruedMinor: 15_000, creditedNowMinor: 5_000 });
  });

  it('credits nothing when settled again with no new views', async () => {
    const { service, ledger } = build({
      views: { 'creator-1': 20_000 },
      accrued: { 'creator-1': 10_000 },
    });

    await service.settleCampaign('campaign-1', 'brand-user');

    expect(ledger.recordEarning).not.toHaveBeenCalled();
  });

  it('stops each creator at the per-creator maximum', async () => {
    const { service } = build({
      views: { 'creator-1': 1_000_000 },
      campaign: { maxRewardPerCreatorAmount: 7_000 },
    });

    const summary = await service.settleCampaign('campaign-1', 'brand-user');

    expect(summary.creators[0].accruedMinor).toBe(7_000);
  });

  it('never spends more than has been funded', async () => {
    const { service } = build({
      approvedCreators: ['creator-1', 'creator-2'],
      views: { 'creator-1': 100_000, 'creator-2': 100_000 },
      fundedMinor: 60_000,
    });

    const summary = await service.settleCampaign('campaign-1', 'brand-user');

    expect(summary.creators.map((creator) => creator.accruedMinor)).toEqual([50_000, 10_000]);
    expect(summary.budgetRemainingMinor).toBe(0);
  });

  it('pays nothing to an approved creator with no recorded views', async () => {
    const { service, ledger } = build();

    const summary = await service.settleCampaign('campaign-1', 'brand-user');

    expect(ledger.recordEarning).not.toHaveBeenCalled();
    expect(summary.creators[0].creditedNowMinor).toBe(0);
  });

  it('credits nothing to a creator under an open fraud case', async () => {
    const { service, ledger } = build({
      views: { 'creator-1': 20_000 },
      pausedCreators: ['creator-1'],
    });

    const summary = await service.settleCampaign('campaign-1', 'brand-user');

    expect(ledger.recordEarning).not.toHaveBeenCalled();
    expect(summary.creators[0]).toMatchObject({ creditedNowMinor: 0, paused: true });
  });

  it('keeps crediting other creators while one is paused', async () => {
    const { service } = build({
      approvedCreators: ['creator-1', 'creator-2'],
      views: { 'creator-1': 20_000, 'creator-2': 20_000 },
      pausedCreators: ['creator-1'],
    });

    const summary = await service.settleCampaign('campaign-1', 'brand-user');

    expect(summary.creators.map((creator) => creator.creditedNowMinor)).toEqual([0, 10_000]);
  });

  it('releases the claim when the ledger posting fails', async () => {
    const { service, ledger, earnings } = build({ views: { 'creator-1': 20_000 } });
    ledger.recordEarning.mockRejectedValue(new Error('ledger down'));

    await expect(service.settleCampaign('campaign-1', 'brand-user')).rejects.toThrow('ledger down');

    expect(earnings.get('creator-1')).toBe(0);
  });
});

describe('EarningsSettlementService.getCreatorEarnings', () => {
  it('reports views, credited earnings and the cap for each campaign the creator submitted to', async () => {
    const service = new EarningsSettlementService(
      {
        creatorEarning: {
          findMany: jest
            .fn()
            .mockResolvedValue([{ campaignId: 'campaign-1', accruedAmount: 1_200 }]),
        },
      } as never,
      {
        findManyByIds: jest.fn().mockResolvedValue([
          {
            id: 'campaign-1',
            title: 'Summer launch',
            currencyCode: 'USD',
            maxRewardPerCreatorAmount: 5_000,
          },
          { id: 'campaign-2', title: 'Fall', currencyCode: 'USD', maxRewardPerCreatorAmount: null },
        ]),
      } as never,
      {} as never,
      { campaignIdsForCreator: jest.fn().mockResolvedValue(['campaign-1', 'campaign-2']) } as never,
      {
        latestViewsByCampaignForCreator: jest
          .fn()
          .mockResolvedValue(new Map([['campaign-1', 4_000]])),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      { pausedCampaignIds: jest.fn().mockResolvedValue(new Set(['campaign-1'])) } as never,
    );

    const earnings = await service.getCreatorEarnings('creator-1');

    expect(earnings).toEqual([
      expect.objectContaining({
        campaignId: 'campaign-1',
        views: 4_000,
        accruedMinor: 1_200,
        capMinor: 5_000,
        paused: true,
      }),
      expect.objectContaining({
        campaignId: 'campaign-2',
        views: 0,
        accruedMinor: 0,
        capMinor: null,
      }),
    ]);
  });

  it('returns nothing for a creator who has not submitted to any campaign', async () => {
    const service = new EarningsSettlementService(
      {} as never,
      {} as never,
      {} as never,
      { campaignIdsForCreator: jest.fn().mockResolvedValue([]) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(service.getCreatorEarnings('creator-1')).resolves.toEqual([]);
  });
});
