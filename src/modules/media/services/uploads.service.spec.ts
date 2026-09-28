import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MediaKind, MediaStatus } from '@prisma/client';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { PrismaService } from '@platform/database/prisma.service';
import { UploadsService } from './uploads.service';

const OWNER = 'user-1';
const PNG_BYTES = Buffer.from('89504e470d0a1a0a', 'hex');

function buildFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: 'logo.png',
    encoding: '7bit',
    mimetype: 'image/png',
    size: PNG_BYTES.length,
    stream: Readable.from(PNG_BYTES),
    destination: '',
    filename: 'logo.png',
    path: '',
    buffer: PNG_BYTES,
    ...overrides,
  };
}

function setup(
  uploadDir: string,
  baseUrl = 'https://cdn.test/uploads',
): { service: UploadsService; create: jest.Mock; root: string } {
  const create = jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'asset-1', ...data }));
  const prisma = { mediaAsset: { create } } as unknown as PrismaService;
  const config = {
    get: (key: string) => (key === 'UPLOAD_DIR' ? uploadDir : baseUrl),
  } as unknown as ConfigService<never, true>;
  return { service: new UploadsService(prisma, config), create, root: uploadDir };
}

describe('UploadsService.storeImage', () => {
  let uploadDir: string;

  beforeEach(() => {
    uploadDir = mkdtempSync(join(tmpdir(), 'zeyoo-uploads-'));
  });

  afterEach(() => {
    rmSync(uploadDir, { recursive: true, force: true });
  });

  it('writes the bytes to disk and returns a public URL', async () => {
    const { service, create, root } = setup(uploadDir);

    const result = await service.storeImage(OWNER, buildFile());

    expect(result.url).toBe(`https://cdn.test/uploads/${result.key}`);
    expect(result.contentType).toBe('image/png');
    expect(result.size).toBe(PNG_BYTES.length);
    expect(readFileSync(join(root, result.key))).toEqual(PNG_BYTES);
    expect(create).toHaveBeenCalledWith({
      data: {
        ownerUserId: OWNER,
        kind: MediaKind.IMAGE,
        status: MediaStatus.READY,
        sourceUrl: result.url,
      },
    });
  });

  it('names the file from the detected type, never the client name', async () => {
    const { service, root } = setup(uploadDir);

    const result = await service.storeImage(
      OWNER,
      buildFile({ mimetype: 'image/jpeg', originalname: '../../etc/passwd' }),
    );

    expect(result.key).toMatch(/^[0-9a-f-]{36}\.jpg$/);
    expect(existsSync(join(root, result.key))).toBe(true);
  });

  it('strips a trailing slash from the public base URL', async () => {
    const { service } = setup(uploadDir, 'https://cdn.test/uploads/');

    const result = await service.storeImage(OWNER, buildFile());

    expect(result.url).toBe(`https://cdn.test/uploads/${result.key}`);
  });

  it('rejects a missing file and non-image types', async () => {
    const { service, create } = setup(uploadDir);

    await expect(service.storeImage(OWNER, undefined)).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.storeImage(OWNER, buildFile({ mimetype: 'application/pdf' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });
});
