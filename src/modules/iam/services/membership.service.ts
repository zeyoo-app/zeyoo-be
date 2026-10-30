import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Membership, OrgRole, User } from '@prisma/client';
import { PrismaService } from '@platform/database/prisma.service';
import { AppPaths } from '@platform/links';
import { Mailer } from '@platform/mail';
import { OrganizationService } from './organization.service';
import { UserService } from './user.service';

export type MemberWithUser = Membership & { user: Pick<User, 'id' | 'email' | 'type'> };

@Injectable()
export class MembershipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizations: OrganizationService,
    private readonly users: UserService,
    private readonly mailer: Mailer,
  ) {}

  async listMembers(organizationId: string, requesterId: string): Promise<MemberWithUser[]> {
    await this.organizations.assertMember(organizationId, requesterId);
    return this.prisma.membership.findMany({
      where: { organizationId },
      include: { user: { select: { id: true, email: true, type: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Adds a teammate by email. Someone without a Zeyoo account yet gets one, as a brand
   * user, so they can sign in with that email straight away (passwordless: the emailed
   * code is the credential). Either way they are emailed that they were added.
   */
  async invite(
    organizationId: string,
    requesterId: string,
    email: string,
    role: OrgRole,
  ): Promise<Membership> {
    await this.assertOwner(organizationId, requesterId);
    const address = email.trim().toLowerCase();

    const invitee =
      (await this.users.findByEmail(address)) ?? (await this.users.createInvitedBrandUser(address));
    if (invitee.type === 'CREATOR') {
      throw new ConflictException(
        'That email belongs to a creator account. Invite a different email for your team.',
      );
    }
    const alreadyMember = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId: invitee.id, organizationId } },
      select: { id: true },
    });
    if (alreadyMember) {
      throw new ConflictException('This user is already a member.');
    }
    const membership = await this.prisma.membership.create({
      data: { organizationId, userId: invitee.id, role },
    });
    await this.tellInvitee(organizationId, address);
    return membership;
  }

  private async tellInvitee(organizationId: string, email: string): Promise<void> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    });
    try {
      await this.mailer.sendNotification(
        email,
        `You were added to ${organization?.name ?? 'a brand'} on Zeyoo`,
        `You can now manage ${organization?.name ?? 'the brand'}'s campaigns. Sign in to Zeyoo with this email address to get started.`,
        { label: 'Sign in to Zeyoo', url: AppPaths.signIn },
      );
    } catch {
      // The membership stands even if the email cannot go out; the owner sees the teammate listed.
    }
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
