import { ForbiddenException } from '@nestjs/common';
import { CampaignService } from '@modules/campaigns/campaigns.public';
import { MetricService } from '@modules/social/social.public';
import { SubmissionService } from '@modules/submissions/submissions.public';
import { CommunitySubmissionsService } from './community-submissions.service';

function setup(canView = true) {
  const getById = jest.fn(() =>
    canView ? Promise.resolve({}) : Promise.reject(new ForbiddenException()),
  );
  const approvedForCommunity = jest.fn().mockResolvedValue([
    {
      id: 's-1',
      creatorUserId: 'creator-1',
      creator: { displayName: 'Layla', username: 'layla', avatarUrl: null },
      posts: [{ platform: 'TIKTOK', url: 'https://tiktok.com/@layla/video/1' }],
      approvedAt: new Date('2026-11-20'),
    },
    {
      id: 's-2',
      creatorUserId: 'creator-2',
      creator: null,
      posts: [],
      approvedAt: new Date('2026-11-19'),
    },
  ]);
  const latestReadingsByCreator = jest
    .fn()
    .mockResolvedValue(new Map([['creator-1', { views: 1200 }]]));
  const service = new CommunitySubmissionsService(
    { getById } as unknown as CampaignService,
    { approvedForCommunity } as unknown as SubmissionService,
    { latestReadingsByCreator } as unknown as MetricService,
  );
  return { service, approvedForCommunity };
}

describe('CommunitySubmissionsService', () => {
  it('lists approved posts with their views', async () => {
    const { service } = setup();

    const list = await service.list('campaign-1', 'viewer-1');

    expect(list.map((item) => [item.id, item.views])).toEqual([
      ['s-1', 1200],
      ['s-2', 0],
    ]);
  });

  it('refuses someone who may not see the campaign', async () => {
    const { service, approvedForCommunity } = setup(false);

    await expect(service.list('campaign-1', 'stranger')).rejects.toBeInstanceOf(ForbiddenException);
    expect(approvedForCommunity).not.toHaveBeenCalled();
  });
});
