import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Organization } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '@platform/database/prisma.service';

const SLUG_SUFFIX_BYTES = 4;

@Injectable()
export class OrganizationService {
  constructor(private readonly prisma: PrismaService) {}

  // Creating an organization makes the creator its first OWNER, atomically.
  create(ownerUserId: string, input: { name: string; website?: string; industry?: string; logoUrl?: string }): Promise<Organization> {
    return this.prisma.organization.create({
      data: {
        ...input,
        slug: this.slugify(input.name),
        memberships: { create: { userId: ownerUserId, role: 'OWNER' } },
      },
    });
  }

  listAll(): Promise<Organization[]> {
    return this.prisma.organization.findMany({ orderBy: { createdAt: 'desc' } });
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

  async update(organizationId: string, userId: string, input: { name?: string; website?: string; industry?: string; logoUrl?: string }): Promise<Organization> {
    await this.assertMember(organizationId, userId);
    return this.prisma.organization.update({ where: { id: organizationId }, data: input });
  }

  async isMember(organizationId: string, userId: string): Promise<boolean> {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      select: { id: true },
    });
    return membership !== null;
  }

  async assertMember(organizationId: string, userId: string): Promise<void> {
    if (!(await this.isMember(organizationId, userId))) {
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
