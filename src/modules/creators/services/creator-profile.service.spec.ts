import { ConflictException } from '@nestjs/common';
import { CreatorProfile, VerificationStatus } from '@prisma/client';
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
