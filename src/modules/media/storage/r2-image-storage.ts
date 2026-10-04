import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '@platform/config/env.schema';
import { ImageStorage } from './image-storage';

/**
 * Cloudflare R2 adapter. R2 speaks the S3 API, so the stock S3 client is pointed
 * at the account's R2 endpoint. Keys are random UUIDs and never change, so the
 * objects are cached immutably by the CDN and browsers.
 */
@Injectable()
export class R2ImageStorage extends ImageStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService<Env, true>) {
    super();
    this.bucket = config.get('R2_BUCKET', { infer: true });
    this.client = new S3Client({
      region: 'auto',
      // Newer SDKs attach extra checksum headers by default; R2 only needs them when
      // an operation requires one, and skipping them avoids compatibility errors.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      endpoint: `https://${config.get('R2_ACCOUNT_ID', { infer: true })}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.get('R2_ACCESS_KEY_ID', { infer: true }),
        secretAccessKey: config.get('R2_SECRET_ACCESS_KEY', { infer: true }),
      },
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
  }
}
