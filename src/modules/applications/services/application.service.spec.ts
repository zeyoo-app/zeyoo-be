import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Application, Campaign } from '@prisma/client';
import { PrismaService } from '@platform/database/prisma.service';
import { CampaignService, InvitationService } from '@modules/campaigns/campaigns.public';
import { CreatorProfileService } from '@modules/creators/creators.public';
import { OrganizationService } from '@modules/iam/iam.public';
import { NotificationService } from '@modules/notifications/notifications.public';
import { ApplicationService } from './application.service';

interface Mocks {
  requireCampaign: jest.Mock;
  hasPendingInvitation: jest.Mock;
  markAccepted: jest.Mock;
  assertMember: jest.Mock;
  findExisting: jest.Mock;
  create: jest.Mock;
  findApplication: jest.Mock;
  update: jest.Mock;
  notify: jest.Mock;
}

function buildCampaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: 'campaign-1',
    organizationId: 'org-1',
    status: 'PUBLISHED',
    visibility: 'PUBLIC',
    ...overrides,
  } as unknown as Campaign;
}

function setup(campaign: Campaign): { service: ApplicationService; mocks: Mocks } {
  const mocks: Mocks = {
    requireCampaign: jest.fn().mockResolvedValue(campaign),
    hasPendingInvitation: jest.fn().mockResolvedValue(false),
    markAccepted: jest.fn().mockResolvedValue(undefined),
    assertMember: jest.fn().mockResolvedValue(undefined),
    findExisting: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockImplementation(({ data }) => Promise.resolve(data as Application)),
    findApplication: jest.fn(),
    update: jest.fn().mockResolvedValue({} as Application),
    notify: jest.fn().mockResolvedValue(undefined),
  };
  const prisma = {
    application: {
      findUnique: jest
        .fn()
        .mockImplementation((args: { where: { id?: string } }) =>
          args.where.id ? mocks.findApplication() : mocks.findExisting(),
        ),
      create: mocks.create,
      update: mocks.update,
    },
  } as unknown as PrismaService;
  const campaigns = { requireCampaign: mocks.requireCampaign } as unknown as CampaignService;
  const invitations = {
    hasPendingInvitation: mocks.hasPendingInvitation,
    markAccepted: mocks.markAccepted,
  } as unknown as InvitationService;
  const organizations = {
    assertMember: mocks.assertMember,
    memberUserIds: jest.fn().mockResolvedValue(['brand-owner', 'brand-editor']),
  } as unknown as OrganizationService;
  const notifications = { notify: mocks.notify } as unknown as NotificationService;
  const profiles = {
    summariesByUserIds: jest
      .fn()
      .mockResolvedValue(new Map([['creator-1', { displayName: 'Sara K.' }]])),
  } as unknown as CreatorProfileService;
  return {
    service: new ApplicationService(
      prisma,
      campaigns,
      invitations,
      organizations,
      notifications,
      profiles,
    ),
    mocks,
  };
}

const acceptTerms = { acceptedTerms: true as const };

describe('ApplicationService.apply', () => {
  it('creates a direct application to a public campaign', async () => {
    const { service, mocks } = setup(buildCampaign({ visibility: 'PUBLIC' }));

    const application = await service.apply('campaign-1', 'creator-1', acceptTerms);

    expect(application.source).toBe('DIRECT');
    expect(mocks.markAccepted).not.toHaveBeenCalled();
  });

  it('tells every member of the brand team about the new application', async () => {
    const { service, mocks } = setup(buildCampaign({ title: 'Summer' } as Partial<Campaign>));

    await service.apply('campaign-1', 'creator-1', acceptTerms);

    expect(mocks.notify).toHaveBeenCalledTimes(2);
    expect(mocks.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'brand-owner',
        type: 'APPLICATION_RECEIVED',
        body: 'Sara K. applied to "Summer".',
      }),
    );
  });

  it('creates an invitation application when the creator has a pending invite', async () => {
    const { service, mocks } = setup(buildCampaign({ visibility: 'PRIVATE' }));
    mocks.hasPendingInvitation.mockResolvedValue(true);

    const application = await service.apply('campaign-1', 'creator-1', acceptTerms);

    expect(application.source).toBe('INVITATION');
    expect(mocks.markAccepted).toHaveBeenCalledWith('campaign-1', 'creator-1');
  });

  it('accepts the invitation when an invited creator applies to a public campaign', async () => {
    const { service, mocks } = setup(buildCampaign({ visibility: 'PUBLIC' }));
    mocks.hasPendingInvitation.mockResolvedValue(true);

    const application = await service.apply('campaign-1', 'creator-1', acceptTerms);

    expect(application.source).toBe('INVITATION');
    expect(mocks.markAccepted).toHaveBeenCalledWith('campaign-1', 'creator-1');
  });

  it('rejects applying to a private campaign without an invitation', async () => {
    const { service, mocks } = setup(buildCampaign({ visibility: 'PRIVATE' }));
    mocks.hasPendingInvitation.mockResolvedValue(false);

    await expect(service.apply('campaign-1', 'creator-1', acceptTerms)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('rejects applying to a campaign that is not published', async () => {
    const { service } = setup(buildCampaign({ status: 'DRAFT' }));

    await expect(service.apply('campaign-1', 'creator-1', acceptTerms)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('ApplicationService.review', () => {
  it('rejects reviewing an application that is not pending', async () => {
    const { service, mocks } = setup(buildCampaign());
    mocks.findApplication.mockResolvedValue({
      id: 'app-1',
      campaignId: 'campaign-1',
      status: 'APPROVED',
    });

    await expect(service.approve('app-1', 'brand-user')).rejects.toBeInstanceOf(ConflictException);
  });

  it('tells the creator when their application is approved', async () => {
    const { service, mocks } = setup(buildCampaign({ title: 'Summer' } as Partial<Campaign>));
    mocks.findApplication.mockResolvedValue({
      id: 'app-1',
      campaignId: 'campaign-1',
      creatorUserId: 'creator-1',
      status: 'PENDING',
    });

    await service.approve('app-1', 'brand-user');

    expect(mocks.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'creator-1',
        type: 'APPLICATION_REVIEWED',
        title: 'Your application was approved',
      }),
    );
  });
});
