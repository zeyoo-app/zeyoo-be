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
