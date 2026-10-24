import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CreatorProfile, Prisma, SocialAccount, SocialPlatform } from '@prisma/client';
import { PrismaService } from '@platform/database/prisma.service';
import { NotificationService } from '@modules/notifications/notifications.public';
import { CreateCreatorProfileDto, UpdateCreatorProfileDto } from '../dto/creator-profile.dto';

export type CreatorProfileWithAccounts = CreatorProfile & { socialAccounts: SocialAccount[] };

export interface CreatorSummary {
  displayName: string;
  username: string;
  avatarUrl: string | null;
  accounts: { platform: SocialPlatform; handle: string; verified: boolean }[];
}

export interface DirectoryFilter {
  platform?: SocialPlatform;
  verifiedOnly?: boolean;
}

const CONNECTED_ACCOUNTS = { where: { status: 'CONNECTED' as const } };

const DELETED_DISPLAY_NAME = 'Deleted creator';

@Injectable()
export class CreatorProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  // The caller already holds CreatorProfileManage, so the account is a creator.
  // Idempotent: saving setup again (a retry, or going back and continuing) updates
  // the profile that already exists instead of failing or creating a second one.
  async create(userId: string, dto: CreateCreatorProfileDto): Promise<CreatorProfile> {
    return this.withUsernameConflict(() =>
      this.prisma.creatorProfile.upsert({
        where: { userId },
        create: { ...dto, userId },
        update: dto,
      }),
    );
  }

  getOwn(userId: string): Promise<CreatorProfile> {
    return this.findByUserIdOrThrow(userId);
  }

  async update(userId: string, dto: UpdateCreatorProfileDto): Promise<CreatorProfile> {
    const profile = await this.findByUserIdOrThrow(userId);
    return this.withUsernameConflict(() =>
      this.prisma.creatorProfile.update({ where: { id: profile.id }, data: dto }),
    );
  }

  /** Replaces the profile's personal details with placeholders; reviews and payouts keep a valid owner. */
  async anonymize(userId: string): Promise<void> {
    const profile = await this.prisma.creatorProfile.findUnique({ where: { userId } });
    if (!profile) {
      return;
    }
    await this.prisma.$transaction([
      this.prisma.socialAccount.deleteMany({ where: { creatorProfileId: profile.id } }),
      this.prisma.creatorProfile.update({
        where: { id: profile.id },
        data: {
          displayName: DELETED_DISPLAY_NAME,
          username: `deleted-${profile.id}`,
          avatarUrl: null,
          headline: null,
          bio: null,
          country: null,
          verificationStatus: 'UNVERIFIED',
        },
      }),
    ]);
  }

  /** What a payment provider needs to know about a creator, or null before setup is done. */
  async payoutIdentity(
    userId: string,
  ): Promise<{ displayName: string; country: string | null } | null> {
    const profile = await this.prisma.creatorProfile.findUnique({ where: { userId } });
    return profile ? { displayName: profile.displayName, country: profile.country } : null;
  }

  /** Display details for many creators at once, for lists that name them (e.g. submissions). */
  async summariesByUserIds(userIds: string[]): Promise<Map<string, CreatorSummary>> {
    if (userIds.length === 0) {
      return new Map();
    }
    const profiles = await this.prisma.creatorProfile.findMany({
      where: { userId: { in: userIds } },
      include: { socialAccounts: CONNECTED_ACCOUNTS },
    });
    return new Map(
      profiles.map((profile) => [
        profile.userId,
        {
          displayName: profile.displayName,
          username: profile.username,
          avatarUrl: profile.avatarUrl,
          accounts: profile.socialAccounts.map((account) => ({
            platform: account.platform,
            handle: account.handle,
            verified: account.verifiedAt !== null,
          })),
        },
      ]),
    );
  }

  async requestVerification(userId: string): Promise<CreatorProfile> {
    const profile = await this.findByUserIdOrThrow(userId);
    this.assertVerifiable(profile.verificationStatus);
    return this.prisma.creatorProfile.update({
      where: { id: profile.id },
      data: { verificationStatus: 'PENDING' },
    });
  }

  /** Staff decision on a pending verification request; the note is shown to the creator. */
  async reviewVerification(
    userId: string,
    decision: 'VERIFIED' | 'REJECTED',
    note: string | null,
  ): Promise<CreatorProfile> {
    const profile = await this.findByUserIdOrThrow(userId);
    if (profile.verificationStatus !== 'PENDING') {
      throw new ConflictException('This creator has no verification request waiting.');
    }
    const reviewed = await this.prisma.creatorProfile.update({
      where: { id: profile.id },
      data: {
        verificationStatus: decision,
        verificationNote: decision === 'REJECTED' ? note : null,
        verificationReviewedAt: new Date(),
      },
    });
    await this.notifications.notify({
      userId,
      type: 'VERIFICATION_REVIEWED',
      title: decision === 'VERIFIED' ? 'You are verified' : 'Verification not approved',
      body:
        decision === 'VERIFIED'
          ? 'Brands can now see your verified badge.'
          : `Your request was not approved: ${note ?? 'no reason given'}. You can fix this and request again.`,
    });
    return reviewed;
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

  /** Usernames are unique; report a clash in words instead of a generic "already exists". */
  private async withUsernameConflict<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('That username is already taken.');
      }
      throw error;
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
