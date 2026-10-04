import { ConflictException } from '@nestjs/common';
import { CreatorProfile, Prisma, VerificationStatus } from '@prisma/client';
import { PrismaService } from '@platform/database/prisma.service';
import { CreatorProfileService } from './creator-profile.service';

interface Mocks {
  findUnique: jest.Mock;
  update: jest.Mock;
}

function buildProfile(status: VerificationStatus): CreatorProfile {
  return {
    id: 'profile-1',
    userId: 'user-1',
    displayName: 'Creator One',
    username: 'creator.one',
    avatarUrl: null,
    headline: null,
    bio: null,
    country: null,
    verificationStatus: status,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function setup(profile: CreatorProfile | null): { service: CreatorProfileService; mocks: Mocks } {
  const mocks: Mocks = {
    findUnique: jest.fn().mockResolvedValue(profile),
    update: jest.fn().mockResolvedValue(profile),
  };
  const prisma = {
    creatorProfile: { findUnique: mocks.findUnique, update: mocks.update },
  } as unknown as PrismaService;
  return { service: new CreatorProfileService(prisma), mocks };
}

describe('CreatorProfileService.requestVerification', () => {
  it('moves an unverified profile to PENDING', async () => {
    const { service, mocks } = setup(buildProfile('UNVERIFIED'));

    await service.requestVerification('user-1');

    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'profile-1' },
      data: { verificationStatus: 'PENDING' },
    });
  });

  it('rejects a profile that is already verified', async () => {
    const { service, mocks } = setup(buildProfile('VERIFIED'));

    await expect(service.requestVerification('user-1')).rejects.toBeInstanceOf(ConflictException);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('rejects a profile whose verification is already pending', async () => {
    const { service } = setup(buildProfile('PENDING'));

    await expect(service.requestVerification('user-1')).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('CreatorProfileService.update', () => {
  it('saves the new name, username, and photo', async () => {
    const { service, mocks } = setup(buildProfile('UNVERIFIED'));

    await service.update('user-1', {
      displayName: 'New Name',
      username: 'new.name',
      avatarUrl: 'https://cdn.test/a.png',
    });

    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'profile-1' },
      data: { displayName: 'New Name', username: 'new.name', avatarUrl: 'https://cdn.test/a.png' },
    });
  });

  it('reports a taken username in words', async () => {
    const { service, mocks } = setup(buildProfile('UNVERIFIED'));
    mocks.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(service.update('user-1', { username: 'taken' })).rejects.toThrow(
      'That username is already taken.',
    );
  });
});
