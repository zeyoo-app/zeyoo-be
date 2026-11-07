import { BadRequestException, ConflictException } from '@nestjs/common';
import { MetricsUnavailableError } from '@modules/social/social.public';
import { ViewTrackingService } from './view-tracking.service';

const YOUTUBE_POST = {
  platform: 'YOUTUBE',
  url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
};
const TIKTOK_POST = { platform: 'TIKTOK', url: 'https://www.tiktok.com/@ada/video/123' };

const SUBMISSION = {
  submissionId: 'submission-1',
  campaignId: 'campaign-1',
  creatorUserId: 'creator-1',
  status: 'APPROVED',
  isUpload: false,
  posts: [YOUTUBE_POST] as { platform: string; url: string }[],
};

const SETTLEMENT = { campaignId: 'campaign-1', creators: [], totalAccruedMinor: 0 };

function build(submission: Partial<typeof SUBMISSION> = {}): {
  service: ViewTrackingService;
  recordSnapshot: jest.Mock;
  fetchForPost: jest.Mock;
  settle: jest.Mock;
  latestByPlatformForCreator: jest.Mock;
} {
  const recordSnapshot = jest.fn().mockResolvedValue(undefined);
  const latestByPlatformForCreator = jest.fn().mockResolvedValue(new Map());
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
    { recordSnapshot, latestByPlatformForCreator } as never,
    { fetchForPost } as never,
    { settleCampaignAsSystem: settle } as never,
  );
  return { service, recordSnapshot, fetchForPost, settle, latestByPlatformForCreator };
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
    const { service, fetchForPost } = build({ isUpload: true, posts: [] });

    const result = await service.syncSubmission('submission-1', 'brand-user');

    expect(fetchForPost).not.toHaveBeenCalled();
    expect(result.results[0].outcome).toMatchObject({
      status: 'UNAVAILABLE',
      reason: 'UNSUPPORTED_PLATFORM',
    });
  });

  it('records typed-in views against the post the brand chose', async () => {
    const { service, recordSnapshot } = build({ posts: [YOUTUBE_POST, TIKTOK_POST] });

    await service.recordManualViews('submission-1', 'brand-user', {
      platform: 'TIKTOK',
      views: 300,
    });

    expect(recordSnapshot).toHaveBeenCalledWith(expect.objectContaining({ platform: 'TIKTOK' }));
  });

  it('asks which post typed-in views are for when there are several', async () => {
    const { service, recordSnapshot } = build({ posts: [YOUTUBE_POST, TIKTOK_POST] });

    await expect(
      service.recordManualViews('submission-1', 'brand-user', { views: 300 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(recordSnapshot).not.toHaveBeenCalled();
  });

  it('refuses views for a platform the submission has no post on', async () => {
    const { service } = build();

    await expect(
      service.recordManualViews('submission-1', 'brand-user', { platform: 'X', views: 3 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('counts views for an uploaded video on the campaign platform', async () => {
    const { service, recordSnapshot } = build({ isUpload: true, posts: [] });

    await service.recordManualViews('submission-1', 'brand-user', { views: 50 });

    expect(recordSnapshot).toHaveBeenCalledWith(expect.objectContaining({ platform: 'TIKTOK' }));
  });

  it('reads every post when syncing, and one failing does not stop the others', async () => {
    const { service, recordSnapshot, fetchForPost } = build({ posts: [YOUTUBE_POST, TIKTOK_POST] });
    fetchForPost
      .mockResolvedValueOnce({
        platform: 'YOUTUBE',
        metrics: { views: 900, likes: 0, comments: 0, shares: 0, capturedAt: new Date() },
      })
      .mockRejectedValueOnce(
        new MetricsUnavailableError('NEEDS_CREATOR_CONNECTION', 'Creator must connect TikTok.'),
      );

    const result = await service.syncSubmission('submission-1', 'brand-user');

    expect(fetchForPost).toHaveBeenCalledTimes(2);
    expect(recordSnapshot).toHaveBeenCalledTimes(1);
    expect(result.results.map((item) => [item.platform, item.outcome.status])).toEqual([
      ['YOUTUBE', 'RECORDED'],
      ['TIKTOK', 'UNAVAILABLE'],
    ]);
  });

  it("shows each post's latest reading, and zero for a post not read yet", async () => {
    const { service, latestByPlatformForCreator } = build({ posts: [YOUTUBE_POST, TIKTOK_POST] });
    const capturedAt = new Date('2026-11-01T00:00:00Z');
    latestByPlatformForCreator.mockResolvedValue(
      new Map([
        ['YOUTUBE', { views: 900, likes: 4, comments: 1, shares: 0, source: 'MANUAL', capturedAt }],
      ]),
    );

    const views = await service.getSubmissionViews('submission-1', 'brand-user');

    expect(views.posts).toEqual([
      {
        ...YOUTUBE_POST,
        views: 900,
        likes: 4,
        comments: 1,
        shares: 0,
        source: 'MANUAL',
        capturedAt,
      },
      {
        ...TIKTOK_POST,
        views: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        source: null,
        capturedAt: null,
      },
    ]);
  });
});
