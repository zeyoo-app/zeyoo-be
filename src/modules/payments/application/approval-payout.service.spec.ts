import { MetricsUnavailableError } from '@modules/social/social.public';
import { ApprovalPayoutService } from './approval-payout.service';

const CAMPAIGN = { id: 'campaign-1', organizationId: 'org-1', currencyCode: 'USD' };
const SUBMISSION = {
  submissionId: 'sub-1',
  campaignId: 'campaign-1',
  creatorUserId: 'creator-1',
  isUpload: false,
  posts: [
    { platform: 'YOUTUBE', url: 'https://youtube.com/shorts/a' },
    { platform: 'INSTAGRAM', url: 'https://instagram.com/reel/b' },
  ],
};

function build({
  recorded = new Map(),
  fetch = jest.fn(),
  sync = jest.fn().mockResolvedValue({ results: [] }),
  status = 'APPROVED',
}: {
  recorded?: Map<string, unknown>;
  fetch?: jest.Mock;
  sync?: jest.Mock;
  status?: string;
} = {}) {
  const payCreator = jest
    .fn()
    .mockResolvedValue({ creatorUserId: 'creator-1', views: 10_000, creditedNowMinor: 5_000 });
  const quote = jest.fn().mockImplementation(async (_c, _u, views: number) => ({ views }));
  const review = jest
    .fn()
    .mockResolvedValue({ id: 'sub-1', campaignId: 'campaign-1', creatorUserId: 'creator-1' });
  const service = new ApprovalPayoutService(
    { requireCampaign: jest.fn().mockResolvedValue(CAMPAIGN) } as never,
    { assertMember: jest.fn().mockResolvedValue(undefined) } as never,
    { withLatestLink: jest.fn().mockResolvedValue({ ...SUBMISSION, status }) } as never,
    { review } as never,
    { latestByPlatformForCreator: jest.fn().mockResolvedValue(recorded) } as never,
    { fetchForPost: fetch } as never,
    { quote, payCreator } as never,
    { syncSubmission: sync } as never,
  );
  return { service, quote, review, payCreator };
}

describe('ApprovalPayoutService', () => {
  it('reads every channel live and quotes the total', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValueOnce({ metrics: { views: 7_000, capturedAt: new Date() } })
      .mockResolvedValueOnce({ metrics: { views: 3_000, capturedAt: new Date() } });
    const { service, quote } = build({ fetch });

    const preview = await service.preview('sub-1', 'brand-user');

    expect(preview.posts.map((post) => [post.platform, post.views, post.source])).toEqual([
      ['YOUTUBE', 7_000, 'LIVE'],
      ['INSTAGRAM', 3_000, 'LIVE'],
    ]);
    expect(preview.totalViews).toBe(10_000);
    expect(quote).toHaveBeenCalledWith(CAMPAIGN, 'creator-1', 10_000);
  });

  it('falls back to the last recorded count when a channel cannot be read', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValueOnce({ metrics: { views: 7_000, capturedAt: new Date() } })
      .mockRejectedValueOnce(new MetricsUnavailableError('UNSUPPORTED_PLATFORM', 'Not linked.'));
    const recorded = new Map([
      ['INSTAGRAM', { views: 1_500, source: 'MANUAL', capturedAt: new Date() }],
    ]);
    const { service } = build({ fetch, recorded });

    const preview = await service.preview('sub-1', 'brand-user');

    expect(preview.posts[1]).toMatchObject({
      views: 1_500,
      source: 'MANUAL',
      unavailableMessage: 'Not linked.',
    });
    expect(preview.totalViews).toBe(8_500);
  });

  it('approves, then pays only that creator for the views so far', async () => {
    const { service, review, payCreator } = build();

    const result = await service.approveAndPay('sub-1', 'brand-user');

    expect(review).toHaveBeenCalledWith('sub-1', 'brand-user', {
      decision: 'APPROVED',
      note: undefined,
    });
    expect(payCreator).toHaveBeenCalledWith(CAMPAIGN, 'creator-1');
    expect(result).toMatchObject({ paidNowMinor: 5_000, views: 10_000, payoutDeferred: false });
  });

  it('keeps the approval when paying fails, for the brand to pay later', async () => {
    const sync = jest.fn().mockRejectedValue(new Error('ledger down'));
    const { service } = build({ sync });

    const result = await service.approveAndPay('sub-1', 'brand-user');

    expect(result).toMatchObject({ paidNowMinor: 0, payoutDeferred: true });
  });

  it('pays an approved creator for new views when the brand asks', async () => {
    const { service, payCreator } = build();

    const result = await service.payForNewViews('sub-1', 'brand-user');

    expect(payCreator).toHaveBeenCalledWith(CAMPAIGN, 'creator-1');
    expect(result.paidNowMinor).toBe(5_000);
  });

  it('refuses to pay for a submission that is not approved', async () => {
    const { service, payCreator } = build({ status: 'PENDING' });

    await expect(service.payForNewViews('sub-1', 'brand-user')).rejects.toThrow(
      'Only an approved submission can be paid.',
    );
    expect(payCreator).not.toHaveBeenCalled();
  });
});
