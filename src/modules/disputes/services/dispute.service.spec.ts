import { ConflictException, ForbiddenException } from '@nestjs/common';
import { DisputeService } from './dispute.service';

interface Setup {
  dispute?: Record<string, unknown>;
  activeExisting?: boolean;
  submissionCreator?: string;
}

function build({
  dispute = {},
  activeExisting = false,
  submissionCreator = 'creator-1',
}: Setup = {}): {
  service: DisputeService;
  overrideAsAdmin: jest.Mock;
  closeAsAdmin: jest.Mock;
  notify: jest.Mock;
  updateDispute: jest.Mock;
  getById: jest.Mock;
  transaction: jest.Mock;
} {
  const record = {
    id: 'dispute-1',
    openedByUserId: 'creator-1',
    subjectType: 'SUBMISSION',
    subjectId: 'submission-1',
    reason: 'Unfair rejection',
    status: 'OPEN',
    responseDueAt: null,
    respondedAt: null,
    escalatedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    events: [],
    ...dispute,
  };
  const updateDispute = jest.fn().mockResolvedValue(record);
  const prisma = {
    dispute: {
      create: jest.fn().mockResolvedValue(record),
      findFirst: jest.fn().mockResolvedValue(activeExisting ? { id: 'old' } : null),
      findUnique: jest.fn().mockResolvedValue(record),
      findMany: jest.fn().mockResolvedValue([record]),
      update: updateDispute,
    },
    disputeEvent: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn().mockResolvedValue([]),
  };
  const overrideAsAdmin = jest.fn().mockResolvedValue({});
  const closeAsAdmin = jest.fn().mockResolvedValue({});
  const getById = jest.fn().mockResolvedValue({});
  const notify = jest.fn().mockResolvedValue(undefined);
  const service = new DisputeService(
    prisma as never,
    {
      getById,
      withLatestLink: jest
        .fn()
        .mockResolvedValue({ campaignId: 'campaign-1', creatorUserId: submissionCreator }),
    } as never,
    { overrideAsAdmin } as never,
    {
      requireCampaign: jest.fn().mockResolvedValue({ title: 'Summer', organizationId: 'org-1' }),
    } as never,
    { assertMember: jest.fn() } as never,
    { assertOwnedBy: jest.fn() } as never,
    { closeAsAdmin, assertCreatorOf: jest.fn(), findView: jest.fn() } as never,
    {
      findById: jest.fn().mockResolvedValue({ type: 'CREATOR', email: 'a@b.c' }),
      listAll: jest.fn().mockResolvedValue([{ id: 'admin-1', type: 'ADMIN' }]),
    } as never,
    { summariesByUserIds: jest.fn().mockResolvedValue(new Map()) } as never,
    { notify } as never,
  );
  return {
    service,
    overrideAsAdmin,
    closeAsAdmin,
    notify,
    updateDispute,
    getById,
    transaction: prisma.$transaction,
  };
}

describe('DisputeService.open', () => {
  it('checks the opener is a party to the submission and alerts admins', async () => {
    const { service, getById, notify } = build();

    await service.open('creator-1', {
      subjectType: 'SUBMISSION',
      subjectId: 'submission-1',
      reason: 'Unfair rejection',
    });

    expect(getById).toHaveBeenCalledWith('submission-1', 'creator-1');
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'admin-1', type: 'DISPUTE_OPENED' }),
    );
  });

  it('refuses a second active dispute about the same thing', async () => {
    const { service } = build({ activeExisting: true });

    await expect(
      service.open('creator-1', {
        subjectType: 'SUBMISSION',
        subjectId: 'submission-1',
        reason: 'Again please',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('DisputeService.get', () => {
  it("hides one user's dispute from another", async () => {
    const { service } = build();

    await expect(service.get('dispute-1', 'stranger', false)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('DisputeService.decide', () => {
  it("approves the submission when a creator's appeal is upheld", async () => {
    const { service, overrideAsAdmin, notify } = build();

    await service.decide('dispute-1', 'admin-1', { outcome: 'UPHELD', note: 'Met the brief.' });

    expect(overrideAsAdmin).toHaveBeenCalledWith(
      'submission-1',
      'admin-1',
      'APPROVED',
      'Met the brief.',
    );
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'creator-1', title: 'Your dispute was upheld' }),
    );
  });

  it('leaves the submission alone when the appeal is denied', async () => {
    const { service, overrideAsAdmin } = build();

    await service.decide('dispute-1', 'admin-1', { outcome: 'DENIED', note: 'Did not meet it.' });

    expect(overrideAsAdmin).not.toHaveBeenCalled();
  });

  it('clears the fraud case when its dispute is upheld', async () => {
    const { service, closeAsAdmin } = build({
      dispute: { subjectType: 'FRAUD_CASE', subjectId: 'case-1' },
    });

    await service.decide('dispute-1', 'admin-1', {
      outcome: 'UPHELD',
      note: 'Views were genuine.',
    });

    expect(closeAsAdmin).toHaveBeenCalledWith('case-1', 'admin-1', 'DISMISSED');
  });

  it('confirms the fraud case when its dispute is denied', async () => {
    const { service, closeAsAdmin } = build({
      dispute: { subjectType: 'FRAUD_CASE', subjectId: 'case-1' },
    });

    await service.decide('dispute-1', 'admin-1', { outcome: 'DENIED', note: 'Views were bought.' });

    expect(closeAsAdmin).toHaveBeenCalledWith('case-1', 'admin-1', 'RESOLVED');
  });

  it('cannot decide a closed dispute', async () => {
    const { service } = build({ dispute: { status: 'RESOLVED' } });

    await expect(
      service.decide('dispute-1', 'admin-1', { outcome: 'UPHELD', note: 'Fine.' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

const FIVE_DAYS_AGO = new Date(Date.now() - 5 * 24 * 60 * 60 * 1_000);

describe('DisputeService.escalate', () => {
  it('escalates an unanswered dispute that is past its response time', async () => {
    const { service, notify, transaction } = build({ dispute: { createdAt: FIVE_DAYS_AGO } });

    await service.escalate('dispute-1', 'creator-1');

    expect(transaction).toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'admin-1', type: 'DISPUTE_ESCALATED' }),
    );
  });

  it('refuses while support is still within its response time', async () => {
    const { service } = build();

    await expect(service.escalate('dispute-1', 'creator-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('refuses once support has replied', async () => {
    const { service } = build({ dispute: { createdAt: FIVE_DAYS_AGO, respondedAt: new Date() } });

    await expect(service.escalate('dispute-1', 'creator-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('refuses to escalate twice', async () => {
    const { service } = build({ dispute: { createdAt: FIVE_DAYS_AGO, escalatedAt: new Date() } });

    await expect(service.escalate('dispute-1', 'creator-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("only lets the person who opened it escalate", async () => {
    const { service } = build({ dispute: { createdAt: FIVE_DAYS_AGO } });

    await expect(service.escalate('dispute-1', 'stranger')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('DisputeService.escalateOverdue', () => {
  it('escalates the unanswered disputes past their deadline', async () => {
    const { service, transaction } = build({ dispute: { createdAt: FIVE_DAYS_AGO } });

    await expect(service.escalateOverdue()).resolves.toBe(1);
    expect(transaction).toHaveBeenCalled();
  });

  it('leaves a dispute alone while it is within its response time', async () => {
    const { service, transaction } = build();

    await expect(service.escalateOverdue()).resolves.toBe(0);
    expect(transaction).not.toHaveBeenCalled();
  });
});
