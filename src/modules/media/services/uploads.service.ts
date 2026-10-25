import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MediaKind, MediaStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { Env } from '@platform/config/env.schema';
import { PrismaService } from '@platform/database/prisma.service';
import { VIDEO_MAX_BYTES } from '@platform/http/image-upload.constants';
import {
  StartVideoUploadDto,
  UploadedImageDto,
  UploadedVideoDto,
  VideoUploadTicketDto,
} from '../dto/media.dto';
import { ImageStorage } from '../storage/image-storage';

/**
 * Formats the mobile picker can hand us. The extension is derived from the
 * detected type, never from the client-supplied file name, so a caller cannot
 * talk the server into writing an executable extension.
 */
const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
};

const VIDEO_EXTENSIONS: Record<StartVideoUploadDto['contentType'], string> = {
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
};

/** Long enough for a large video on a slow phone connection. */
const VIDEO_UPLOAD_TTL_SECONDS = 60 * 60;

/**
 * Stores uploaded images in object storage (Cloudflare R2) and hands back a public
 * URL. The asset is also recorded as a MediaAsset so ownership and future cleanup
 * have a trail.
 */
@Injectable()
export class UploadsService {
  private readonly publicBaseUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ImageStorage,
    config: ConfigService<Env, true>,
  ) {
    this.publicBaseUrl = config.get('PUBLIC_ASSET_BASE_URL', { infer: true }).replace(/\/+$/, '');
  }

  async storeImage(
    ownerUserId: string,
    file: Express.Multer.File | undefined,
  ): Promise<UploadedImageDto> {
    if (!file) {
      throw new BadRequestException('Attach an image in the "file" field.');
    }
    const extension = IMAGE_EXTENSIONS[file.mimetype];
    if (!extension) {
      throw new BadRequestException('Images must be JPEG, PNG, WebP or HEIC.');
    }

    const key = `${randomUUID()}${extension}`;
    await this.storage.put(key, file.buffer, file.mimetype);

    const url = `${this.publicBaseUrl}/${key}`;
    const asset = await this.prisma.mediaAsset.create({
      data: {
        ownerUserId,
        kind: MediaKind.IMAGE,
        status: MediaStatus.READY,
        sourceUrl: url,
      },
    });

    return {
      id: asset.id,
      url,
      key,
      contentType: file.mimetype,
      size: file.size,
    };
  }

  /**
   * Step 1 of a video upload (contract §1.3, "upload or link"): reserve a key, record a
   * PENDING asset and hand back a signed URL. The client sends the bytes straight to
   * storage, so a large video never passes through the API.
   */
  async startVideoUpload(
    ownerUserId: string,
    dto: StartVideoUploadDto,
  ): Promise<VideoUploadTicketDto> {
    if (dto.size > VIDEO_MAX_BYTES) {
      throw new BadRequestException(
        `Videos can be up to ${Math.round(VIDEO_MAX_BYTES / (1024 * 1024))} MB.`,
      );
    }
    const key = `videos/${randomUUID()}${VIDEO_EXTENSIONS[dto.contentType]}`;
    const url = `${this.publicBaseUrl}/${key}`;
    const uploadUrl = await this.storage.presignPut(
      key,
      dto.contentType,
      dto.size,
      VIDEO_UPLOAD_TTL_SECONDS,
    );
    const asset = await this.prisma.mediaAsset.create({
      data: { ownerUserId, kind: MediaKind.VIDEO, status: MediaStatus.PENDING, sourceUrl: url },
    });
    return {
      id: asset.id,
      uploadUrl,
      uploadHeaders: { 'Content-Type': dto.contentType },
      url,
      expiresAt: new Date(Date.now() + VIDEO_UPLOAD_TTL_SECONDS * 1_000).toISOString(),
    };
  }

  /** Step 2: confirm the bytes really arrived (and are a video within the limit), then mark it ready. */
  async completeVideoUpload(ownerUserId: string, assetId: string): Promise<UploadedVideoDto> {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id: assetId } });
    if (!asset || asset.kind !== MediaKind.VIDEO) {
      throw new NotFoundException('Video upload not found.');
    }
    if (asset.ownerUserId !== ownerUserId) {
      throw new ForbiddenException('This upload belongs to someone else.');
    }
    const stored = await this.storage.stat(this.keyOf(asset.sourceUrl));
    if (!stored) {
      throw new ConflictException('The video has not finished uploading yet.');
    }
    const contentType = stored.contentType ?? '';
    if (stored.size > VIDEO_MAX_BYTES || !(contentType in VIDEO_EXTENSIONS)) {
      await this.prisma.mediaAsset.update({
        where: { id: asset.id },
        data: { status: MediaStatus.FAILED },
      });
      throw new BadRequestException('That file is not a supported video.');
    }
    if (asset.status !== MediaStatus.READY) {
      await this.prisma.mediaAsset.update({
        where: { id: asset.id },
        data: { status: MediaStatus.READY },
      });
    }
    return { id: asset.id, url: asset.sourceUrl, contentType, size: stored.size };
  }

  /**
   * An uploaded submission must be the submitter's own video that finished uploading,
   * so nobody can submit someone else's file or an arbitrary URL as an "upload".
   */
  async assertOwnReadyVideo(ownerUserId: string, url: string): Promise<void> {
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { ownerUserId, sourceUrl: url, kind: MediaKind.VIDEO, status: MediaStatus.READY },
      select: { id: true },
    });
    if (!asset) {
      throw new BadRequestException('Upload the video first, then submit it.');
    }
  }

  private keyOf(url: string): string {
    return url.slice(this.publicBaseUrl.length + 1);
  }
}
