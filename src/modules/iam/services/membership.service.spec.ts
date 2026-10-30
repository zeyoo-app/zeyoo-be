import { ConflictException } from '@nestjs/common';
import { MembershipService } from './membership.service';

function build(existingUser: { id: string; type: string } | null): {
  service: MembershipService;
  createInvitedBrandUser: jest.Mock;
  createMembership: jest.Mock;
  sendNotification: jest.Mock;
} {
  const createMembership = jest.fn().mockResolvedValue({ id: 'm-1' });
  const prisma = {
    membership: {
      // First the owner check reads the requester's membership, then the duplicate check.
      findUnique: jest.fn().mockResolvedValueOnce({ role: 'OWNER' }).mockResolvedValueOnce(null),
      create: createMembership,
    },
    organization: { findUnique: jest.fn().mockResolvedValue({ name: 'Acme' }) },
  };
  const createInvitedBrandUser = jest
    .fn()
    .mockResolvedValue({ id: 'new-user', type: 'BRAND_USER' });
  const users = {
    findByEmail: jest.fn().mockResolvedValue(existingUser),
    createInvitedBrandUser,
  };
  const sendNotification = jest.fn().mockResolvedValue(undefined);
  return {
    service: new MembershipService(
      prisma as never,
      {} as never,
      users as never,
      {
        sendNotification,
      } as never,
    ),
    createInvitedBrandUser,
    createMembership,
    sendNotification,
  };
}

describe('MembershipService.invite', () => {
  it('creates a brand account for someone new and emails them', async () => {
    const { service, createInvitedBrandUser, createMembership, sendNotification } = build(null);

    await service.invite('org-1', 'owner-1', ' New@Example.com ', 'MEMBER');

    expect(createInvitedBrandUser).toHaveBeenCalledWith('new@example.com');
    expect(createMembership).toHaveBeenCalledWith({
      data: { organizationId: 'org-1', userId: 'new-user', role: 'MEMBER' },
    });
    expect(sendNotification).toHaveBeenCalledWith(
      'new@example.com',
      'You were added to Acme on Zeyoo',
      expect.stringContaining('Sign in to Zeyoo with this email'),
      { label: 'Sign in to Zeyoo', url: '/sign-in' },
    );
  });

  it('adds an existing brand user without creating another account', async () => {
    const { service, createInvitedBrandUser, createMembership } = build({
      id: 'u-2',
      type: 'BRAND_USER',
    });

    await service.invite('org-1', 'owner-1', 'teammate@example.com', 'OWNER');

    expect(createInvitedBrandUser).not.toHaveBeenCalled();
    expect(createMembership).toHaveBeenCalledWith({
      data: { organizationId: 'org-1', userId: 'u-2', role: 'OWNER' },
    });
  });

  it('refuses a creator account', async () => {
    const { service, createMembership } = build({ id: 'c-1', type: 'CREATOR' });

    await expect(
      service.invite('org-1', 'owner-1', 'creator@example.com', 'MEMBER'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(createMembership).not.toHaveBeenCalled();
  });
});
