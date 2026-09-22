import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { SocialAccount } from '@prisma/client';
import { PrismaService } from '@platform/database/prisma.service';
import { ConnectSocialAccountDto } from '../dto/social-account.dto';
import { CreatorProfileService } from './creator-profile.service';

@Injectable()
export class SocialAccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: CreatorProfileService,
  ) {}

  // Connecting the same platform again reconnects it with the latest handle,
  // rather than creating a duplicate (one account per platform per creator).
  async connect(userId: string, dto: ConnectSocialAccountDto): Promise<SocialAccount> {
    const profile = await this.profiles.getOwn(userId);
    const connection = {
      handle: dto.handle,
      platformAccountId: dto.platformAccountId ?? null,
      status: 'CONNECTED' as const,
      connectedAt: new Date(),
    };
    return this.prisma.socialAccount.upsert({
      where: {
        creatorProfileId_platform: { creatorProfileId: profile.id, platform: dto.platform },
      },
      create: { creatorProfileId: profile.id, platform: dto.platform, ...connection },
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
