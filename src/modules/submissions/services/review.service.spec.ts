import { ConflictException } from '@nestjs/common';
import { Submission } from '@prisma/client';
import { PrismaService } from '@platform/database/prisma.service';
import { CampaignService } from '@modules/campaigns/campaigns.public';
import { OrganizationService } from '@modules/iam/iam.public';
import { ReviewService } from './review.service';
import { SubmissionService } from './submission.service';

interface Mocks {
  requireSubmission: jest.Mock;
  requireCampaign: jest.Mock;
  assertMember: jest.Mock;
  findFirstRevision: jest.Mock;
  reviewCreate: jest.Mock;
  submissionUpdate: jest.Mock;
  transaction: jest.Mock;
}

function buildSubmission(status: Submission['status']): Submission {
  return {
    id: 'submission-1',
    campaignId: 'campaign-1',
    creatorUserId: 'creator-1',
    status,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function setup(status: Submission['status']): { service: ReviewService; mocks: Mocks } {
  const mocks: Mocks = {
    requireSubmission: jest.fn().mockResolvedValue(buildSubmission(status)),
    requireCampaign: jest.fn().mockResolvedValue({ organizationId: 'org-1' }),
    assertMember: jest.fn().mockResolvedValue(undefined),
    findFirstRevision: jest.fn().mockResolvedValue({ id: 'revision-1' }),
    reviewCreate: jest.fn().mockReturnValue('review-op'),
    submissionUpdate: jest.fn().mockReturnValue('update-op'),
    transaction: jest.fn().mockResolvedValue([{}, buildSubmission('NEEDS_CHANGES')]),
  };
  const prisma = {
    submissionRevision: { findFirst: mocks.findFirstRevision },
    review: { create: mocks.reviewCreate },
    submission: { update: mocks.submissionUpdate },
    $transaction: mocks.transaction,
  } as unknown as PrismaService;
  const submissions = {
    requireSubmission: mocks.requireSubmission,
  } as unknown as SubmissionService;
  const campaigns = { requireCampaign: mocks.requireCampaign } as unknown as CampaignService;
  const organizations = { assertMember: mocks.assertMember } as unknown as OrganizationService;
  return { service: new ReviewService(prisma, submissions, campaigns, organizations), mocks };
}

describe('ReviewService.review', () => {
  it('rejects reviewing a submission that is not pending', async () => {
    const { service } = setup('APPROVED');

    await expect(
      service.review('submission-1', 'brand-user', { decision: 'APPROVED' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('maps a changes-requested decision to NEEDS_CHANGES', async () => {
    const { service, mocks } = setup('PENDING');

    await service.review('submission-1', 'brand-user', { decision: 'CHANGES_REQUESTED' });

    expect(mocks.submissionUpdate).toHaveBeenCalledWith({
      where: { id: 'submission-1' },
      data: { status: 'NEEDS_CHANGES' },
    });
  });
});
