import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Membership, OrgRole, User } from '@prisma/client';
import { PrismaService } from '@platform/database/prisma.service';
import { OrganizationService } from './organization.service';
import { UserService } from './user.service';

export type MemberWithUser = Membership & { user: Pick<User, 'id' | 'email' | 'type'> };

@Injectable()
export class MembershipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizations: OrganizationService,
    private readonly users: UserService,
  ) {}

  async listMembers(organizationId: string, requesterId: string): Promise<MemberWithUser[]> {
    await this.organizations.assertMember(organizationId, requesterId);
    return this.prisma.membership.findMany({
      where: { organizationId },
      include: { user: { select: { id: true, email: true, type: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async invite(
    organizationId: string,
    requesterId: string,
    email: string,
    role: OrgRole,
  ): Promise<Membership> {
    await this.assertOwner(organizationId, requesterId);

    const invitee = await this.users.findByEmail(email);
    if (!invitee) {
      throw new NotFoundException('No user with this email exists yet.');
    }
    const alreadyMember = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId: invitee.id, organizationId } },
      select: { id: true },
    });
    if (alreadyMember) {
      throw new ConflictException('This user is already a member.');
    }
    return this.prisma.membership.create({
      data: { organizationId, userId: invitee.id, role },
    });
  }

  async updateRole(
    organizationId: string,
    requesterId: string,
    membershipId: string,
    role: OrgRole,
  ): Promise<Membership> {
    await this.assertOwner(organizationId, requesterId);
    const membership = await this.getMembershipInOrg(organizationId, membershipId);
    if (membership.role === 'OWNER' && role === 'MEMBER') {
      await this.assertNotLastOwner(organizationId);
    }
    return this.prisma.membership.update({ where: { id: membership.id }, data: { role } });
  }

  async remove(organizationId: string, requesterId: string, membershipId: string): Promise<void> {
    await this.assertOwner(organizationId, requesterId);
    const membership = await this.getMembershipInOrg(organizationId, membershipId);
    if (membership.role === 'OWNER') {
      await this.assertNotLastOwner(organizationId);
    }
    await this.prisma.membership.delete({ where: { id: membership.id } });
  }

  async assertOwner(organizationId: string, userId: string): Promise<void> {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      select: { role: true },
    });
    if (membership?.role !== 'OWNER') {
      throw new ForbiddenException('Only an organization owner may perform this action.');
    }
  }

  private async getMembershipInOrg(
    organizationId: string,
    membershipId: string,
  ): Promise<Membership> {
    const membership = await this.prisma.membership.findUnique({ where: { id: membershipId } });
    if (!membership || membership.organizationId !== organizationId) {
      throw new NotFoundException('Membership not found in this organization.');
    }
    return membership;
  }

  private async assertNotLastOwner(organizationId: string): Promise<void> {
    const ownerCount = await this.prisma.membership.count({
      where: { organizationId, role: 'OWNER' },
    });
    if (ownerCount <= 1) {
      throw new ConflictException('An organization must keep at least one owner.');
    }
  }
}
