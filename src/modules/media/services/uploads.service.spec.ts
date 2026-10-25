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
  presignPut: jest.Mock;
  stat: jest.Mock;
  findUnique: jest.Mock;
  findFirst: jest.Mock;
  update: jest.Mock;
} {
  const create = jest
    .fn()
    .mockImplementation(({ data }) => Promise.resolve({ id: 'asset-1', ...data }));
  const findUnique = jest.fn();
  const findFirst = jest.fn();
  const update = jest.fn().mockResolvedValue({});
  const prisma = {
    mediaAsset: { create, findUnique, findFirst, update },
  } as unknown as PrismaService;
  const put = jest.fn().mockResolvedValue(undefined);
  const presignPut = jest.fn().mockResolvedValue('https://r2.test/signed');
  const stat = jest.fn();
  const storage = { put, presignPut, stat } as unknown as ImageStorage;
  const config = { get: () => baseUrl } as unknown as ConfigService<never, true>;
  return {
    service: new UploadsService(prisma, storage, config),
    create,
    put,
    presignPut,
    stat,
    findUnique,
    findFirst,
    update,
  };
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

const MB = 1024 * 1024;

describe('UploadsService.startVideoUpload', () => {
  it('signs a direct upload for the declared type and size and records a pending video', async () => {
    const { service, presignPut, create } = setup();

    const ticket = await service.startVideoUpload(OWNER, {
      contentType: 'video/mp4',
      size: 20 * MB,
    });

    expect(ticket.uploadUrl).toBe('https://r2.test/signed');
    expect(ticket.uploadHeaders).toEqual({ 'Content-Type': 'video/mp4' });
    expect(ticket.url).toMatch(/^https:\/\/cdn\.test\/videos\/[0-9a-f-]{36}\.mp4$/);
    const key = ticket.url.replace('https://cdn.test/', '');
    expect(presignPut).toHaveBeenCalledWith(key, 'video/mp4', 20 * MB, 3600);
    expect(create).toHaveBeenCalledWith({
      data: {
        ownerUserId: OWNER,
        kind: MediaKind.VIDEO,
        status: MediaStatus.PENDING,
        sourceUrl: ticket.url,
      },
    });
  });

  it('refuses a video over the size limit', async () => {
    const { service, presignPut } = setup();

    await expect(
      service.startVideoUpload(OWNER, { contentType: 'video/mp4', size: 600 * MB }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(presignPut).not.toHaveBeenCalled();
  });
});

describe('UploadsService.completeVideoUpload', () => {
  const asset = {
    id: 'asset-1',
    ownerUserId: OWNER,
    kind: MediaKind.VIDEO,
    status: MediaStatus.PENDING,
    sourceUrl: 'https://cdn.test/videos/abc.mp4',
  };

  it('marks the video ready once it is in storage', async () => {
    const { service, findUnique, stat, update } = setup();
    findUnique.mockResolvedValue(asset);
    stat.mockResolvedValue({ size: 10 * MB, contentType: 'video/mp4' });

    const result = await service.completeVideoUpload(OWNER, 'asset-1');

    expect(stat).toHaveBeenCalledWith('videos/abc.mp4');
    expect(update).toHaveBeenCalledWith({
      where: { id: 'asset-1' },
      data: { status: MediaStatus.READY },
    });
    expect(result).toEqual({
      id: 'asset-1',
      url: asset.sourceUrl,
      contentType: 'video/mp4',
      size: 10 * MB,
    });
  });

  it('says so when the bytes have not arrived yet', async () => {
    const { service, findUnique, stat } = setup();
    findUnique.mockResolvedValue(asset);
    stat.mockResolvedValue(null);

    await expect(service.completeVideoUpload(OWNER, 'asset-1')).rejects.toThrow(
      'The video has not finished uploading yet.',
    );
  });

  it("refuses to complete someone else's upload", async () => {
    const { service, findUnique } = setup();
    findUnique.mockResolvedValue({ ...asset, ownerUserId: 'someone-else' });

    await expect(service.completeVideoUpload(OWNER, 'asset-1')).rejects.toThrow(
      'belongs to someone else',
    );
  });

  it('marks it failed when what arrived is not a video', async () => {
    const { service, findUnique, stat, update } = setup();
    findUnique.mockResolvedValue(asset);
    stat.mockResolvedValue({ size: 1 * MB, contentType: 'application/x-msdownload' });

    await expect(service.completeVideoUpload(OWNER, 'asset-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(update).toHaveBeenCalledWith({
      where: { id: 'asset-1' },
      data: { status: MediaStatus.FAILED },
    });
  });
});

describe('UploadsService.assertOwnReadyVideo', () => {
  it('accepts the creator’s own finished video', async () => {
    const { service, findFirst } = setup();
    findFirst.mockResolvedValue({ id: 'asset-1' });

    await expect(
      service.assertOwnReadyVideo(OWNER, 'https://cdn.test/videos/a.mp4'),
    ).resolves.toBeUndefined();
  });

  it('refuses a URL that is not one of their finished uploads', async () => {
    const { service, findFirst } = setup();
    findFirst.mockResolvedValue(null);

    await expect(
      service.assertOwnReadyVideo(OWNER, 'https://evil.test/video.mp4'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
