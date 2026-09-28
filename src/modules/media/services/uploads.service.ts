import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MediaKind, MediaStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Env } from '@platform/config/env.schema';
import { PrismaService } from '@platform/database/prisma.service';
import { UploadedImageDto } from '../dto/media.dto';

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

/**
 * Writes uploaded images to local disk and hands back a public URL. The asset is
 * also recorded as a MediaAsset so ownership and future cleanup have a trail.
 *
 * Local disk is the default store; swapping in S3/GCS means replacing the write
 * and URL construction here — the controller and clients stay the same.
 */
@Injectable()
export class UploadsService {
  private readonly root: string;
  private readonly publicBaseUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    this.root = resolve(config.get('UPLOAD_DIR', { infer: true }));
    this.publicBaseUrl = config
      .get('PUBLIC_ASSET_BASE_URL', { infer: true })
      .replace(/\/+$/, '');
  }

  /** Directory served as static assets; mounted by bootstrap in main.ts. */
  get storageRoot(): string {
    return this.root;
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
      throw new BadRequestException(
        'Images must be JPEG, PNG, WebP or HEIC.',
      );
    }

    const key = `${randomUUID()}${extension}`;
    await mkdir(this.root, { recursive: true });
    await writeFile(join(this.root, key), file.buffer, { flag: 'wx' });

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
}
