import { AnalyticsService } from './analytics.service';

function build(totalViews: number, spentMinor: number): AnalyticsService {
  return new AnalyticsService(
    {
      requireCampaign: jest.fn().mockResolvedValue({
        id: 'campaign-1',
        title: 'Summer',
        organizationId: 'org-1',
        currencyCode: 'USD',
        budgetAmount: 100_000,
      }),
    } as never,
    { assertMember: jest.fn().mockResolvedValue(undefined) } as never,
    { summaryForCampaign: jest.fn().mockResolvedValue({ total: 4, approved: 2 }) } as never,
    { summaryForCampaign: jest.fn().mockResolvedValue({ total: 3, approved: 2 }) } as never,
    { totalSucceededMinor: jest.fn().mockResolvedValue(100_000) } as never,
    { totalViewsForCampaign: jest.fn().mockResolvedValue(totalViews) } as never,
    {
      getCampaignEarnings: jest.fn().mockResolvedValue({
        spentMinor,
        creators: [
          { creatorUserId: 'a', views: 100, accruedMinor: 10, paused: false },
          { creatorUserId: 'b', views: 900, accruedMinor: 90, paused: true },
        ],
      }),
    } as never,
    {
      summariesByUserIds: jest.fn().mockResolvedValue(new Map([['b', { displayName: 'Bea' }]])),
    } as never,
  );
}

describe('AnalyticsService.campaignReport', () => {
  it('reports spend, cost per thousand views and creators ranked by views', async () => {
    const report = await build(10_000, 5_000).campaignReport('campaign-1', 'brand-user');

    expect(report.spentMinor).toBe(5_000);
    expect(report.costPerThousandViewsMinor).toBe(500);
    expect(report.topCreators.map((creator) => creator.creatorUserId)).toEqual(['b', 'a']);
    expect(report.topCreators[0]).toMatchObject({ name: 'Bea', paused: true });
  });

  it('has no cost per thousand views before any views exist', async () => {
    const report = await build(0, 0).campaignReport('campaign-1', 'brand-user');

    expect(report.costPerThousandViewsMinor).toBeNull();
  });
});

describe('AnalyticsService.campaignReportCsv', () => {
  it('writes the summary then one row per creator, busiest first', async () => {
    const csv = await build(10_000, 5_000).campaignReportCsv('campaign-1', 'brand-user');
    const lines = csv.trim().split('\r\n');

    expect(lines[0]).toBe('Campaign,Summer');
    expect(lines).toContain('Budget,1000.00');
    expect(lines).toContain('Paid to creators,50.00');
    expect(lines).toContain('"Cost per 1,000 views",5.00');
    expect(lines.slice(-3)).toEqual([
      'Creator,Views,Earned,Earnings paused',
      'Bea,900,0.90,yes',
      'Creator,100,0.10,no',
    ]);
  });
});

describe('AnalyticsService.organizationPerformance', () => {
  function buildForOrganization(): AnalyticsService {
    const campaigns = [
      { id: 'live', title: 'Live', status: 'PUBLISHED', currencyCode: 'USD', budgetAmount: 50_000 },
      { id: 'done', title: 'Done', status: 'CLOSED', currencyCode: 'USD', budgetAmount: 20_000 },
      { id: 'sar', title: 'Riyadh', status: 'PUBLISHED', currencyCode: 'SAR', budgetAmount: 9_000 },
      { id: 'draft', title: 'Draft', status: 'DRAFT', currencyCode: 'USD', budgetAmount: 1_000 },
    ];
    const views: Record<string, number> = { live: 4_000, done: 6_000, sar: 1_000 };
    const spent: Record<string, number> = { live: 4_000, done: 2_500, sar: 700 };
    return new AnalyticsService(
      { listForOrganization: jest.fn().mockResolvedValue(campaigns) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { totalViewsForCampaign: jest.fn((id: string) => Promise.resolve(views[id])) } as never,
      {
        getCampaignEarnings: jest.fn((id: string) => Promise.resolve({ spentMinor: spent[id] })),
      } as never,
      {} as never,
    );
  }

  it('totals views across launched campaigns and leaves drafts out', async () => {
    const performance = await buildForOrganization().organizationPerformance('org-1', 'brand');

    expect(performance.totalViews).toBe(11_000);
    expect(performance.campaigns.map((campaign) => campaign.campaignId)).toEqual([
      'live',
      'done',
      'sar',
    ]);
  });

  it('keeps payouts in different currencies apart', async () => {
    const performance = await buildForOrganization().organizationPerformance('org-1', 'brand');

    expect(performance.paid).toEqual([
      { currencyCode: 'USD', amountMinor: 6_500 },
      { currencyCode: 'SAR', amountMinor: 700 },
    ]);
  });
});
