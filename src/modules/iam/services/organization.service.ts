import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Organization } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '@platform/database/prisma.service';

const SLUG_SUFFIX_BYTES = 4;

@Injectable()
export class OrganizationService {
  constructor(private readonly prisma: PrismaService) {}

  // Creating an organization makes the creator its first OWNER, atomically.
  create(ownerUserId: string, name: string): Promise<Organization> {
    return this.prisma.organization.create({
      data: {
        name,
        slug: this.slugify(name),
        memberships: { create: { userId: ownerUserId, role: 'OWNER' } },
      },
    });
  }

  listForUser(userId: string): Promise<Organization[]> {
    return this.prisma.organization.findMany({
      where: { memberships: { some: { userId } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getForMember(organizationId: string, userId: string): Promise<Organization> {
    await this.assertMember(organizationId, userId);
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!organization) {
      throw new NotFoundException('Organization not found.');
    }
    return organization;
  }

  async assertMember(organizationId: string, userId: string): Promise<void> {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      select: { id: true },
    });
    if (!membership) {
      throw new ForbiddenException('You are not a member of this organization.');
    }
  }

  private slugify(name: string): string {
    const base = name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const suffix = randomBytes(SLUG_SUFFIX_BYTES).toString('hex');
    return `${base || 'org'}-${suffix}`;
  }
}
