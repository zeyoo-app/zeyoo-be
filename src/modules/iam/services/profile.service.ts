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
  email: string | null;
  /** E.164, present on accounts created or linked from a phone number. */
  phone: string | null;
  type: UserType;
  status: UserStatus;
  emailVerifiedAt: Date | null;
  phoneVerifiedAt: Date | null;
  organizations: OrganizationMembershipView[];
  hasCreatorProfile: boolean;
}

@Injectable()
export class ProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(userId: string): Promise<AccountProfile> {
    const [user, creatorProfile] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        include: { memberships: { include: { organization: true } } },
      }),
      this.prisma.creatorProfile.findUnique({ where: { userId }, select: { id: true } }),
    ]);
    if (!user) {
      throw new NotFoundException('User not found.');
    }

    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      type: user.type,
      status: user.status,
      emailVerifiedAt: user.emailVerifiedAt,
      phoneVerifiedAt: user.phoneVerifiedAt,
      organizations: user.memberships.map((membership) => ({
        organizationId: membership.organizationId,
        name: membership.organization.name,
        slug: membership.organization.slug,
        role: membership.role,
      })),
      hasCreatorProfile: Boolean(creatorProfile),
    };
  }
}
