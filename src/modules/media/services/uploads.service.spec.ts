import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MediaKind, MediaStatus } from '@prisma/client';
import { Readable } from 'node:stream';
import { PrismaService } from '@platform/database/prisma.service';
import { ImageStorage } from '../storage/image-storage';
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

function setup(baseUrl = 'https://cdn.test'): {
  service: UploadsService;
  create: jest.Mock;
  put: jest.Mock;
} {
  const create = jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'asset-1', ...data }));
  const prisma = { mediaAsset: { create } } as unknown as PrismaService;
  const put = jest.fn().mockResolvedValue(undefined);
  const storage = { put } as unknown as ImageStorage;
  const config = { get: () => baseUrl } as unknown as ConfigService<never, true>;
  return { service: new UploadsService(prisma, storage, config), create, put };
}

describe('UploadsService.storeImage', () => {
  it('stores the bytes in object storage and returns a public URL', async () => {
    const { service, create, put } = setup();

    const result = await service.storeImage(OWNER, buildFile());

    expect(result.url).toBe(`https://cdn.test/${result.key}`);
    expect(result.contentType).toBe('image/png');
    expect(result.size).toBe(PNG_BYTES.length);
    expect(put).toHaveBeenCalledWith(result.key, PNG_BYTES, 'image/png');
    expect(create).toHaveBeenCalledWith({
      data: {
        ownerUserId: OWNER,
        kind: MediaKind.IMAGE,
        status: MediaStatus.READY,
        sourceUrl: result.url,
      },
    });
  });

  it('names the object from the detected type, never the client name', async () => {
    const { service, put } = setup();

    const result = await service.storeImage(
      OWNER,
      buildFile({ mimetype: 'image/jpeg', originalname: '../../etc/passwd' }),
    );

    expect(result.key).toMatch(/^[0-9a-f-]{36}\.jpg$/);
    expect(put).toHaveBeenCalledWith(result.key, PNG_BYTES, 'image/jpeg');
  });

  it('strips a trailing slash from the public base URL', async () => {
    const { service } = setup('https://cdn.test/');

    const result = await service.storeImage(OWNER, buildFile());

    expect(result.url).toBe(`https://cdn.test/${result.key}`);
  });

  it('records nothing when the storage write fails', async () => {
    const { service, create, put } = setup();
    put.mockRejectedValue(new Error('R2 unavailable'));

    await expect(service.storeImage(OWNER, buildFile())).rejects.toThrow('R2 unavailable');
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects a missing file and non-image types', async () => {
    const { service, create, put } = setup();

    await expect(service.storeImage(OWNER, undefined)).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.storeImage(OWNER, buildFile({ mimetype: 'application/pdf' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(put).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});
