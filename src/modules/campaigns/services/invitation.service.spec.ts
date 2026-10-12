import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { InvitationService } from './invitation.service';

interface Setup {
  campaignStatus?: string;
  user?: { id: string; type: string } | null;
  existingInvitation?: boolean;
}

function build({
  campaignStatus = 'PUBLISHED',
  user = { id: 'creator-1', type: 'CREATOR' },
  existingInvitation = false,
}: Setup = {}): {
  service: InvitationService;
  create: jest.Mock;
  notify: jest.Mock;
} {
  const create = jest.fn().mockResolvedValue({ id: 'invitation-1' });
  const prisma = {
    campaign: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'campaign-1',
        title: 'Summer',
        organizationId: 'org-1',
        status: campaignStatus,
      }),
    },
    campaignInvitation: {
      findUnique: jest.fn().mockResolvedValue(existingInvitation ? { id: 'old' } : null),
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 'invitation-1', creatorUserId: 'creator-1', status: 'PENDING' }]),
      create,
    },
  };
  const notify = jest.fn().mockResolvedValue(undefined);
  const service = new InvitationService(
    prisma as never,
    { assertMember: jest.fn().mockResolvedValue(undefined) } as never,
    {
      findById: jest.fn().mockResolvedValue(user),
      findByEmail: jest.fn().mockResolvedValue(user),
    } as never,
    { notify } as never,
    {
      summariesByUserIds: jest
        .fn()
        .mockResolvedValue(
          new Map([
            ['creator-1', { displayName: 'Ada', username: 'ada', avatarUrl: null, accounts: [] }],
          ]),
        ),
    } as never,
  );
  return { service, create, notify };
}

describe('InvitationService.invite', () => {
  it('invites a creator by id and notifies them', async () => {
    const { service, create, notify } = build();

    await service.invite('campaign-1', 'brand-user', { creatorUserId: 'creator-1' });

    expect(create).toHaveBeenCalledWith({
      data: { campaignId: 'campaign-1', creatorUserId: 'creator-1', invitedByUserId: 'brand-user' },
    });
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'creator-1', type: 'CAMPAIGN_INVITE' }),
    );
  });

  it('invites a creator by email', async () => {
    const { service, create } = build();

    await service.invite('campaign-1', 'brand-user', { creatorEmail: 'ada@example.com' });

    expect(create).toHaveBeenCalled();
  });

  it('refuses a closed campaign', async () => {
    const { service } = build({ campaignStatus: 'CLOSED' });

    await expect(
      service.invite('campaign-1', 'brand-user', { creatorUserId: 'creator-1' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses an account that is not a creator', async () => {
    const { service } = build({ user: { id: 'u', type: 'BRAND_USER' } });

    await expect(
      service.invite('campaign-1', 'brand-user', { creatorUserId: 'u' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reports an unknown creator', async () => {
    const { service } = build({ user: null });

    await expect(
      service.invite('campaign-1', 'brand-user', { creatorUserId: 'missing' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses to invite the same creator twice', async () => {
    const { service } = build({ existingInvitation: true });

    await expect(
      service.invite('campaign-1', 'brand-user', { creatorUserId: 'creator-1' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('InvitationService.listForCampaign', () => {
  it('names each invited creator', async () => {
    const { service } = build();

    const [invitation] = await service.listForCampaign('campaign-1', 'brand-user');

    expect(invitation.creator).toEqual({ displayName: 'Ada', username: 'ada', avatarUrl: null });
  });
});
