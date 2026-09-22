import { Injectable } from '@nestjs/common';
import { ApiKey } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '@platform/database/prisma.service';
import { sha256Hex } from '@platform/security/hashing';
import { MembershipService } from './membership.service';

export type PublicApiKey = Omit<ApiKey, 'keyHash'>;

export interface CreatedApiKey {
  apiKey: PublicApiKey;
  /** The full secret, shown to the caller exactly once. */
  plaintext: string;
}

const KEY_NAMESPACE = 'zk';
const PREFIX_BYTES = 6;
const SECRET_BYTES = 24;

const PUBLIC_FIELDS = {
  id: true,
  organizationId: true,
  name: true,
  prefix: true,
  scopes: true,
  lastUsedAt: true,
  revokedAt: true,
  createdAt: true,
} as const;

@Injectable()
export class ApiKeyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly memberships: MembershipService,
  ) {}

  async create(
    organizationId: string,
    requesterId: string,
    name: string,
    scopes: string[],
  ): Promise<CreatedApiKey> {
    await this.memberships.assertOwner(organizationId, requesterId);

    const prefix = `${KEY_NAMESPACE}_${randomBytes(PREFIX_BYTES).toString('base64url')}`;
    const secret = randomBytes(SECRET_BYTES).toString('base64url');
    const plaintext = `${prefix}_${secret}`;

    const apiKey = await this.prisma.apiKey.create({
      data: { organizationId, name, scopes, prefix, keyHash: sha256Hex(plaintext) },
      select: PUBLIC_FIELDS,
    });
    return { apiKey, plaintext };
  }

  async list(organizationId: string, requesterId: string): Promise<PublicApiKey[]> {
    await this.memberships.assertOwner(organizationId, requesterId);
    return this.prisma.apiKey.findMany({
      where: { organizationId },
      select: PUBLIC_FIELDS,
      orderBy: { createdAt: 'desc' },
    });
  }

  async revoke(organizationId: string, requesterId: string, apiKeyId: string): Promise<void> {
    await this.memberships.assertOwner(organizationId, requesterId);
    await this.prisma.apiKey.updateMany({
      where: { id: apiKeyId, organizationId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
