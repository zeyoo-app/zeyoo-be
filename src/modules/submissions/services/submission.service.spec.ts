import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Submission } from '@prisma/client';
import { PrismaService } from '@platform/database/prisma.service';
import { ApplicationService } from '@modules/applications/applications.public';
import { CampaignService } from '@modules/campaigns/campaigns.public';
import { OrganizationService } from '@modules/iam/iam.public';
import { SubmissionService } from './submission.service';

interface Mocks {
  findUnique: jest.Mock;
  create: jest.Mock;
  update: jest.Mock;
  hasApprovedApplication: jest.Mock;
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
  };
  const prisma = {
    submission: { findUnique: mocks.findUnique, create: mocks.create, update: mocks.update },
  } as unknown as PrismaService;
  const campaigns = {} as unknown as CampaignService;
  const organizations = {} as unknown as OrganizationService;
  const applications = {
    hasApprovedApplication: mocks.hasApprovedApplication,
  } as unknown as ApplicationService;
  return {
    service: new SubmissionService(prisma, campaigns, organizations, applications),
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
