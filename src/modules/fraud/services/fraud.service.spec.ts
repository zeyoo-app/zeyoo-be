import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { FraudService } from './fraud.service';

interface Setup {
  submittedCampaigns?: string[];
  openCase?: boolean;
  caseStatus?: string;
}

function build({
  submittedCampaigns = ['campaign-1'],
  openCase = false,
  caseStatus = 'OPEN',
}: Setup = {}): {
  service: FraudService;
  create: jest.Mock;
  update: jest.Mock;
  notify: jest.Mock;
} {
  const create = jest
    .fn()
    .mockResolvedValue({ id: 'case-1', creatorUserId: 'creator-1', campaignId: 'campaign-1' });
  const update = jest.fn().mockImplementation(async ({ data }) => ({
    id: 'case-1',
    creatorUserId: 'creator-1',
    campaignId: 'campaign-1',
    ...data,
  }));
  const prisma = {
    fraudCase: {
      create,
      update,
      findFirst: jest.fn().mockResolvedValue(openCase ? { id: 'existing' } : null),
      findUnique: jest.fn().mockResolvedValue({
        id: 'case-1',
        campaignId: 'campaign-1',
        creatorUserId: 'creator-1',
        status: caseStatus,
      }),
    },
  };
  const notify = jest.fn().mockResolvedValue(undefined);
  const service = new FraudService(
    prisma as never,
    {
      requireCampaign: jest
        .fn()
        .mockResolvedValue({ id: 'campaign-1', title: 'Summer', organizationId: 'org-1' }),
    } as never,
    { assertMember: jest.fn().mockResolvedValue(undefined) } as never,
    {} as never,
    { notify } as never,
    { campaignIdsForCreator: jest.fn().mockResolvedValue(submittedCampaigns) } as never,
  );
  return { service, create, update, notify };
}

const FLAG = { creatorUserId: 'creator-1', level: 'HIGH' as const, note: 'Bought views' };

describe('FraudService.flag', () => {
  it('opens a case and tells the creator their earnings are paused', async () => {
    const { service, create, notify } = build();

    await service.flag('campaign-1', 'brand-user', FLAG);

    expect(create).toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'creator-1', type: 'FRAUD_FLAGGED' }),
    );
  });

  it('refuses a creator who never submitted to the campaign', async () => {
    const { service, create } = build({ submittedCampaigns: [] });

    await expect(service.flag('campaign-1', 'brand-user', FLAG)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses a second open case for the same creator', async () => {
    const { service } = build({ openCase: true });

    await expect(service.flag('campaign-1', 'brand-user', FLAG)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('FraudService closing', () => {
  it('clears a case and tells the creator earnings resume', async () => {
    const { service, notify } = build();

    await service.closeAsBrand('case-1', 'brand-user', 'DISMISSED');

    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'FRAUD_CLEARED' }));
  });

  it('tells the creator when a case is confirmed', async () => {
    const { service, notify } = build();

    await service.closeAsAdmin('case-1', 'admin-1', 'RESOLVED');

    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'FRAUD_CONFIRMED' }));
  });

  it('cannot close a case twice', async () => {
    const { service } = build({ caseStatus: 'DISMISSED' });

    await expect(service.closeAsAdmin('case-1', 'admin-1', 'RESOLVED')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('FraudService.assertCreatorOf', () => {
  it('rejects a creator who is not the subject of the case', async () => {
    const { service } = build();

    await expect(service.assertCreatorOf('case-1', 'someone-else')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
