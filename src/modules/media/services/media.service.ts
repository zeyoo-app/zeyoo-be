import { Injectable, NotFoundException } from '@nestjs/common';
import { Clip, MediaAsset } from '@prisma/client';
import { PrismaService } from '@platform/database/prisma.service';
import { CreateClipDto, RegisterAssetDto } from '../dto/media.dto';

export type MediaAssetWithClips = MediaAsset & { clips: Clip[] };

@Injectable()
export class MediaService {
  constructor(private readonly prisma: PrismaService) {}

  registerAsset(ownerUserId: string, dto: RegisterAssetDto): Promise<MediaAsset> {
    return this.prisma.mediaAsset.create({ data: { ownerUserId, ...dto } });
  }

  listOwn(ownerUserId: string): Promise<MediaAsset[]> {
    return this.prisma.mediaAsset.findMany({
      where: { ownerUserId },
      orderBy: { createdAt: 'desc' },
    });
  }

  getOwned(ownerUserId: string, assetId: string): Promise<MediaAssetWithClips> {
    return this.requireOwnedAsset(ownerUserId, assetId);
  }

  async requestClip(ownerUserId: string, assetId: string, dto: CreateClipDto): Promise<Clip> {
    await this.requireOwnedAsset(ownerUserId, assetId);
    return this.prisma.clip.create({
      data: { assetId, startSeconds: dto.startSeconds, endSeconds: dto.endSeconds },
    });
  }

  private async requireOwnedAsset(
    ownerUserId: string,
    assetId: string,
  ): Promise<MediaAssetWithClips> {
    const asset = await this.prisma.mediaAsset.findUnique({
      where: { id: assetId },
      include: { clips: true },
    });
    if (!asset || asset.ownerUserId !== ownerUserId) {
      throw new NotFoundException('Media asset not found.');
    }
    return asset;
  }
}
