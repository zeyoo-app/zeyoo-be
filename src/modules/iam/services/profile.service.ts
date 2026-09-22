import { Injectable, NotFoundException } from '@nestjs/common';
import { OrgRole, UserStatus, UserType } from '@prisma/client';
import { PrismaService } from '@platform/database/prisma.service';

export interface OrganizationMembershipView {
  organizationId: string;
  name: string;
  slug: string;
  role: OrgRole;
}

export interface AccountProfile {
  id: string;
  email: string;
  type: UserType;
  status: UserStatus;
  emailVerifiedAt: Date | null;
  organizations: OrganizationMembershipView[];
}

@Injectable()
export class ProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(userId: string): Promise<AccountProfile> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { memberships: { include: { organization: true } } },
    });
    if (!user) {
      throw new NotFoundException('User not found.');
    }

    return {
      id: user.id,
      email: user.email,
      type: user.type,
      status: user.status,
      emailVerifiedAt: user.emailVerifiedAt,
      organizations: user.memberships.map((membership) => ({
        organizationId: membership.organizationId,
        name: membership.organization.name,
        slug: membership.organization.slug,
        role: membership.role,
      })),
    };
  }
}
