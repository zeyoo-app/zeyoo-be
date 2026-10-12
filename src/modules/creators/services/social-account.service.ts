import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SocialAccount, SocialPlatform } from '@prisma/client';
import { PrismaService } from '@platform/database/prisma.service';
import { ConnectSocialAccountDto } from '../dto/social-account.dto';
import { CreatorProfileService } from './creator-profile.service';

const VERIFIED_ONLY_PLATFORMS: SocialPlatform[] = ['INSTAGRAM', 'TIKTOK'];

@Injectable()
export class SocialAccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: CreatorProfileService,
  ) {}

  // Connecting the same platform again reconnects it with the latest handle,
  // rather than creating a duplicate (one account per platform per creator). A
  // typed-in handle is only a claim, so it is never marked verified, and platforms
  // that offer a sign-in must be connected through it instead.
  async connect(userId: string, dto: ConnectSocialAccountDto): Promise<SocialAccount> {
    if (VERIFIED_ONLY_PLATFORMS.includes(dto.platform)) {
      throw new BadRequestException(
        `Connect ${dto.platform} by signing in to it, so the account can be verified.`,
      );
    }
    return this.upsertAccount(userId, {
      platform: dto.platform,
      handle: dto.handle,
      platformAccountId: dto.platformAccountId ?? null,
      verifiedAt: null,
    });
  }

  /** Records an account the creator proved they own by authorising it on the platform. */
  connectVerified(
    userId: string,
    account: { platform: SocialPlatform; handle: string; platformAccountId: string | null },
  ): Promise<SocialAccount> {
    return this.upsertAccount(userId, { ...account, verifiedAt: new Date() });
  }

  private async upsertAccount(
    userId: string,
    account: {
      platform: SocialPlatform;
      handle: string;
      platformAccountId: string | null;
      verifiedAt: Date | null;
    },
  ): Promise<SocialAccount> {
    const profile = await this.profiles.getOwn(userId);
    const { platform, ...details } = account;
    const connection = { ...details, status: 'CONNECTED' as const, connectedAt: new Date() };
    return this.prisma.socialAccount.upsert({
      where: {
        creatorProfileId_platform: { creatorProfileId: profile.id, platform },
      },
      create: { creatorProfileId: profile.id, platform, ...connection },
      update: connection,
    });
  }

  async list(userId: string): Promise<SocialAccount[]> {
    const profile = await this.profiles.getOwn(userId);
    return this.prisma.socialAccount.findMany({
      where: { creatorProfileId: profile.id },
      orderBy: { platform: 'asc' },
    });
  }

  async disconnect(userId: string, socialAccountId: string): Promise<void> {
    const profile = await this.profiles.getOwn(userId);
    const account = await this.getAccountForProfile(profile.id, socialAccountId);
    if (account.status === 'DISCONNECTED') {
      throw new ConflictException('This account is already disconnected.');
    }
    await this.prisma.socialAccount.update({
      where: { id: account.id },
      data: { status: 'DISCONNECTED' },
    });
  }

  private async getAccountForProfile(
    creatorProfileId: string,
    socialAccountId: string,
  ): Promise<SocialAccount> {
    const account = await this.prisma.socialAccount.findUnique({ where: { id: socialAccountId } });
    if (!account || account.creatorProfileId !== creatorProfileId) {
      throw new NotFoundException('Social account not found on this profile.');
    }
    return account;
  }
}
