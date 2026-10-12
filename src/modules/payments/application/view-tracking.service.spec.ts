import { ConflictException } from '@nestjs/common';
import { MetricsUnavailableError } from '@modules/social/social.public';
import { ViewTrackingService } from './view-tracking.service';

const SUBMISSION = {
  submissionId: 'submission-1',
  campaignId: 'campaign-1',
  creatorUserId: 'creator-1',
  status: 'APPROVED',
  postUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
};

const SETTLEMENT = { campaignId: 'campaign-1', creators: [], totalAccruedMinor: 0 };

function build(submission: Partial<typeof SUBMISSION> = {}): {
  service: ViewTrackingService;
  recordSnapshot: jest.Mock;
  fetchForPost: jest.Mock;
  settle: jest.Mock;
} {
  const recordSnapshot = jest.fn().mockResolvedValue(undefined);
  const fetchForPost = jest.fn();
  const settle = jest.fn().mockResolvedValue(SETTLEMENT);
  const service = new ViewTrackingService(
    {
      requireCampaign: jest
        .fn()
        .mockResolvedValue({ id: 'campaign-1', organizationId: 'org-1', platform: 'TIKTOK' }),
    } as never,
    { assertMember: jest.fn().mockResolvedValue(undefined) } as never,
    {
      withLatestLink: jest.fn().mockResolvedValue({ ...SUBMISSION, ...submission }),
      approvedWithLatestLink: jest.fn().mockResolvedValue([{ ...SUBMISSION, ...submission }]),
    } as never,
    { recordSnapshot } as never,
    {
      fetchForPost,
      identify: jest.fn().mockReturnValue({ platform: 'YOUTUBE' }),
    } as never,
    { settleCampaignAsSystem: settle } as never,
  );
  return { service, recordSnapshot, fetchForPost, settle };
}

describe('ViewTrackingService', () => {
  it('records manually entered views as a manual snapshot and settles the campaign', async () => {
    const { service, recordSnapshot, settle } = build();

    const result = await service.recordManualViews('submission-1', 'brand-user', { views: 4_200 });

    expect(recordSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'MANUAL',
        platform: 'YOUTUBE',
        submissionId: 'submission-1',
        metrics: expect.objectContaining({ views: 4_200, likes: null }),
      }),
    );
    expect(settle).toHaveBeenCalledWith('campaign-1');
    expect(result.results[0].outcome).toMatchObject({ status: 'RECORDED', views: 4_200 });
  });

  it('refuses to record views for a submission that is not approved', async () => {
    const { service, recordSnapshot } = build({ status: 'PENDING' });

    await expect(
      service.recordManualViews('submission-1', 'brand-user', { views: 10 }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(recordSnapshot).not.toHaveBeenCalled();
  });

  it('records a platform reading as an API snapshot', async () => {
    const { service, recordSnapshot, fetchForPost } = build();
    fetchForPost.mockResolvedValue({
      platform: 'YOUTUBE',
      metrics: { views: 900, likes: 5, comments: 1, shares: null, capturedAt: new Date() },
    });

    const result = await service.syncSubmission('submission-1', 'brand-user');

    expect(recordSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'PLATFORM_API' }),
    );
    expect(result.results[0].outcome).toMatchObject({ status: 'RECORDED', views: 900 });
  });

  it('reports why a platform could not be read instead of failing the sync', async () => {
    const { service, recordSnapshot, fetchForPost, settle } = build();
    fetchForPost.mockRejectedValue(
      new MetricsUnavailableError('NEEDS_CREATOR_CONNECTION', 'Creator must connect TikTok.'),
    );

    const result = await service.syncSubmission('submission-1', 'brand-user');

    expect(result.results[0].outcome).toEqual({
      status: 'UNAVAILABLE',
      reason: 'NEEDS_CREATOR_CONNECTION',
      message: 'Creator must connect TikTok.',
    });
    expect(recordSnapshot).not.toHaveBeenCalled();
    expect(settle).toHaveBeenCalled();
  });

  it('asks for manual entry when a submission has no post link', async () => {
    const { service, fetchForPost } = build({ postUrl: null as never });

    const result = await service.syncSubmission('submission-1', 'brand-user');

    expect(fetchForPost).not.toHaveBeenCalled();
    expect(result.results[0].outcome).toMatchObject({
      status: 'UNAVAILABLE',
      reason: 'UNSUPPORTED_PLATFORM',
    });
  });
});
