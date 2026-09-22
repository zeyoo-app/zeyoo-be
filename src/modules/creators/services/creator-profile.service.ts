import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CreatorProfile, SocialAccount, SocialPlatform } from '@prisma/client';
import { PrismaService } from '@platform/database/prisma.service';
import { CreateCreatorProfileDto, UpdateCreatorProfileDto } from '../dto/creator-profile.dto';

export type CreatorProfileWithAccounts = CreatorProfile & { socialAccounts: SocialAccount[] };

export interface DirectoryFilter {
  platform?: SocialPlatform;
  verifiedOnly?: boolean;
}

const CONNECTED_ACCOUNTS = { where: { status: 'CONNECTED' as const } };

@Injectable()
export class CreatorProfileService {
  constructor(private readonly prisma: PrismaService) {}

  // The caller already holds CreatorProfileManage, so the account is a creator.
  async create(userId: string, dto: CreateCreatorProfileDto): Promise<CreatorProfile> {
    await this.assertNoProfile(userId);
    return this.prisma.creatorProfile.create({ data: { ...dto, userId } });
  }

  getOwn(userId: string): Promise<CreatorProfile> {
    return this.findByUserIdOrThrow(userId);
  }

  async update(userId: string, dto: UpdateCreatorProfileDto): Promise<CreatorProfile> {
    const profile = await this.findByUserIdOrThrow(userId);
    return this.prisma.creatorProfile.update({ where: { id: profile.id }, data: dto });
  }

  async requestVerification(userId: string): Promise<CreatorProfile> {
    const profile = await this.findByUserIdOrThrow(userId);
    this.assertVerifiable(profile.verificationStatus);
    return this.prisma.creatorProfile.update({
      where: { id: profile.id },
      data: { verificationStatus: 'PENDING' },
    });
  }

  async getPublicByUserId(creatorUserId: string): Promise<CreatorProfileWithAccounts> {
    const profile = await this.prisma.creatorProfile.findUnique({
      where: { userId: creatorUserId },
      include: { socialAccounts: CONNECTED_ACCOUNTS },
    });
    if (!profile) {
      throw new NotFoundException('Creator profile not found.');
    }
    return profile;
  }

  listDirectory(filter: DirectoryFilter): Promise<CreatorProfileWithAccounts[]> {
    return this.prisma.creatorProfile.findMany({
      where: {
        verificationStatus: filter.verifiedOnly ? 'VERIFIED' : undefined,
        socialAccounts: filter.platform
          ? { some: { platform: filter.platform, status: 'CONNECTED' } }
          : undefined,
      },
      include: { socialAccounts: CONNECTED_ACCOUNTS },
      orderBy: { displayName: 'asc' },
    });
  }

  private async assertNoProfile(userId: string): Promise<void> {
    const existing = await this.prisma.creatorProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('A creator profile already exists for this account.');
    }
  }

  private async findByUserIdOrThrow(userId: string): Promise<CreatorProfile> {
    const profile = await this.prisma.creatorProfile.findUnique({ where: { userId } });
    if (!profile) {
      throw new NotFoundException('Creator profile not found.');
    }
    return profile;
  }

  private assertVerifiable(status: CreatorProfile['verificationStatus']): void {
    if (status === 'VERIFIED') {
      throw new ConflictException('This account is already verified.');
    }
    if (status === 'PENDING') {
      throw new ConflictException('Verification is already in progress.');
    }
  }
}
