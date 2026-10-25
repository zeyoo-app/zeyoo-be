import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Submission } from '@prisma/client';
import { PrismaService } from '@platform/database/prisma.service';
import { ApplicationService } from '@modules/applications/applications.public';
import { CampaignService } from '@modules/campaigns/campaigns.public';
import { CreatorProfileService } from '@modules/creators/creators.public';
import { OrganizationService } from '@modules/iam/iam.public';
import { UploadsService } from '@modules/media/media.public';
import { NotificationService } from '@modules/notifications/notifications.public';
import { SubmissionService } from './submission.service';

interface Mocks {
  findUnique: jest.Mock;
  create: jest.Mock;
  update: jest.Mock;
  hasApprovedApplication: jest.Mock;
  assertOwnReadyVideo: jest.Mock;
  notify: jest.Mock;
}

const submitLink = { contentType: 'LINK' as const, contentUrl: 'https://example.com/post' };

function setup(existingSubmission: Submission | null): {
  service: SubmissionService;
  mocks: Mocks;
} {
  const mocks: Mocks = {
    findUnique: jest.fn().mockResolvedValue(existingSubmission),
    create: jest.fn(),
    update: jest.fn(),
    hasApprovedApplication: jest.fn().mockResolvedValue(true),
    assertOwnReadyVideo: jest.fn().mockResolvedValue(undefined),
    notify: jest.fn().mockResolvedValue(undefined),
  };
  const prisma = {
    submission: { findUnique: mocks.findUnique, create: mocks.create, update: mocks.update },
  } as unknown as PrismaService;
  const campaigns = {
    requireCampaign: jest
      .fn()
      .mockResolvedValue({ id: 'campaign-1', title: 'Summer', organizationId: 'org-1' }),
  } as unknown as CampaignService;
  const organizations = {
    memberUserIds: jest.fn().mockResolvedValue(['brand-owner']),
  } as unknown as OrganizationService;
  const applications = {
    hasApprovedApplication: mocks.hasApprovedApplication,
  } as unknown as ApplicationService;
  const profiles = {
    summariesByUserIds: jest
      .fn()
      .mockResolvedValue(new Map([['creator-1', { displayName: 'Ada' }]])),
  } as unknown as CreatorProfileService;
  return {
    service: new SubmissionService(
      prisma,
      campaigns,
      organizations,
      applications,
      profiles,
      { assertOwnReadyVideo: mocks.assertOwnReadyVideo } as unknown as UploadsService,
      { notify: mocks.notify } as unknown as NotificationService,
    ),
    mocks,
  };
}

function buildSubmission(overrides: Partial<Submission> = {}): Submission {
  return {
    id: 'submission-1',
    campaignId: 'campaign-1',
    creatorUserId: 'creator-1',
    status: 'NEEDS_CHANGES',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('SubmissionService.submit', () => {
  it('rejects a creator without an approved application', async () => {
    const { service, mocks } = setup(null);
    mocks.hasApprovedApplication.mockResolvedValue(false);

    await expect(service.submit('campaign-1', 'creator-1', submitLink)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe('SubmissionService.submit with an upload', () => {
  const submitUpload = {
    contentType: 'UPLOAD' as const,
    contentUrl: 'https://cdn.test/videos/a.mp4',
  };

  it('checks the upload is a video the creator finished uploading', async () => {
    const { service, mocks } = setup(null);
    mocks.create.mockResolvedValue({ id: 'submission-1' });

    await service.submit('campaign-1', 'creator-1', submitUpload);

    expect(mocks.assertOwnReadyVideo).toHaveBeenCalledWith('creator-1', submitUpload.contentUrl);
  });

  it("refuses an upload that is not the creator's own finished video", async () => {
    const { service, mocks } = setup(null);
    mocks.assertOwnReadyVideo.mockRejectedValue(new Error('Upload the video first'));

    await expect(service.submit('campaign-1', 'creator-1', submitUpload)).rejects.toThrow(
      'Upload the video first',
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('tells the brand team there is new content to review', async () => {
    const { service, mocks } = setup(null);
    mocks.create.mockResolvedValue({ id: 'submission-1' });

    await service.submit('campaign-1', 'creator-1', submitLink);

    expect(mocks.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'brand-owner',
        type: 'SUBMISSION_RECEIVED',
        body: 'Ada submitted content to "Summer".',
      }),
    );
  });

  it('does not check links against uploads', async () => {
    const { service, mocks } = setup(null);
    mocks.create.mockResolvedValue({ id: 'submission-1' });

    await service.submit('campaign-1', 'creator-1', submitLink);

    expect(mocks.assertOwnReadyVideo).not.toHaveBeenCalled();
  });
});

describe('SubmissionService.resubmit', () => {
  it('rejects revising a submission the caller does not own', async () => {
    const { service } = setup(buildSubmission({ creatorUserId: 'someone-else' }));

    await expect(service.resubmit('submission-1', 'creator-1', submitLink)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects revising unless changes were requested', async () => {
    const { service } = setup(buildSubmission({ status: 'PENDING' }));

    await expect(service.resubmit('submission-1', 'creator-1', submitLink)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('SubmissionService.listForCampaign', () => {
  const REVIEW_LINK = {
    contentType: 'LINK',
    contentUrl: 'https://www.tiktok.com/@creator/video/7234567890123456789',
  };

  function buildForListing(
    accounts: { platform: string; handle: string; verified: boolean }[],
  ): SubmissionService {
    const prisma = {
      submission: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { ...buildSubmission({ status: 'APPROVED' }), revisions: [REVIEW_LINK] },
          ]),
      },
    };
    const campaigns = { requireCampaign: jest.fn().mockResolvedValue({ organizationId: 'org-1' }) };
    const organizations = { assertMember: jest.fn().mockResolvedValue(undefined) };
    const profiles = {
      summariesByUserIds: jest
        .fn()
        .mockResolvedValue(
          new Map([
            ['creator-1', { displayName: 'Ada', username: 'ada', avatarUrl: null, accounts }],
          ]),
        ),
    };
    return new SubmissionService(
      prisma as never,
      campaigns as never,
      organizations as never,
      {} as never,
      profiles as never,
      {} as never,
      {} as never,
    );
  }

  it('names the creator instead of exposing only their id', async () => {
    const service = buildForListing([]);

    const [submission] = await service.listForCampaign('campaign-1', 'brand-user');

    expect(submission.creator).toEqual({ displayName: 'Ada', username: 'ada', avatarUrl: null });
  });

  it('marks the post verified when the creator signed in to that platform', async () => {
    const service = buildForListing([{ platform: 'TIKTOK', handle: 'ada', verified: true }]);

    const [submission] = await service.listForCampaign('campaign-1', 'brand-user');

    expect(submission.accountVerified).toBe(true);
  });

  it('leaves the post unverified when the creator only typed a handle', async () => {
    const service = buildForListing([{ platform: 'TIKTOK', handle: 'ada', verified: false }]);

    const [submission] = await service.listForCampaign('campaign-1', 'brand-user');

    expect(submission.accountVerified).toBe(false);
  });

  it('leaves the post unverified when the verified account is on another platform', async () => {
    const service = buildForListing([{ platform: 'INSTAGRAM', handle: 'ada', verified: true }]);

    const [submission] = await service.listForCampaign('campaign-1', 'brand-user');

    expect(submission.accountVerified).toBe(false);
  });
});
