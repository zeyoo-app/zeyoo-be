import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { StaffAccount, StaffRole } from '@prisma/client';
import { PrismaService } from '@platform/database/prisma.service';

/** Zeyoo's back-office staff accounts, separate from customer users. */
@Injectable()
export class StaffService {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<StaffAccount | null> {
    return this.prisma.staffAccount.findUnique({ where: { id } });
  }

  findActiveByEmail(email: string): Promise<StaffAccount | null> {
    return this.prisma.staffAccount.findFirst({ where: { email, status: 'ACTIVE' } });
  }

  list(): Promise<StaffAccount[]> {
    return this.prisma.staffAccount.findMany({ orderBy: { createdAt: 'asc' } });
  }

  /** Emails of every active staff member, for back-office alerts. */
  async activeEmails(): Promise<string[]> {
    const staff = await this.prisma.staffAccount.findMany({
      where: { status: 'ACTIVE' },
      select: { email: true },
    });
    return staff.map((member) => member.email);
  }

  /** Staff emails by id, for showing who took an action. Unknown ids are left out. */
  async emailsByIds(ids: string[]): Promise<Map<string, string>> {
    const staff = await this.prisma.staffAccount.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { id: true, email: true },
    });
    return new Map(staff.map((member) => [member.id, member.email]));
  }

  async add(email: string, role: StaffRole, addedById: string | null): Promise<StaffAccount> {
    const normalized = email.trim().toLowerCase();
    if (await this.prisma.staffAccount.findUnique({ where: { email: normalized } })) {
      throw new ConflictException('This person already has staff access.');
    }
    return this.prisma.staffAccount.create({ data: { email: normalized, role, addedById } });
  }

  /**
   * Gives a staff member another role. Their open sessions end, so the new role
   * applies at once rather than when their current token runs out.
   */
  async changeRole(id: string, role: StaffRole, requesterId: string): Promise<void> {
    const staff = await this.require(id);
    if (staff.id === requesterId) {
      throw new ConflictException('You cannot change your own role.');
    }
    if (staff.role === role) return;
    if (staff.role === 'SUPER_ADMIN' && staff.status === 'ACTIVE') {
      await this.assertAnotherSuperAdmin();
    }
    await this.prisma.$transaction([
      this.prisma.staffAccount.update({ where: { id }, data: { role } }),
      this.prisma.staffRefreshToken.updateMany({
        where: { staffId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  /** Removes back-office access and ends every session the account has open. */
  async deactivate(id: string, requesterId: string): Promise<void> {
    const staff = await this.require(id);
    if (staff.id === requesterId) {
      throw new ConflictException('You cannot remove your own access.');
    }
    if (staff.status !== 'ACTIVE') {
      throw new ConflictException('This staff account is not active.');
    }
    if (staff.role === 'SUPER_ADMIN') {
      await this.assertAnotherSuperAdmin();
    }
    await this.prisma.$transaction([
      this.prisma.staffAccount.update({ where: { id }, data: { status: 'DEACTIVATED' } }),
      this.prisma.staffRefreshToken.updateMany({
        where: { staffId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  async reactivate(id: string): Promise<void> {
    const staff = await this.require(id);
    if (staff.status !== 'DEACTIVATED') {
      throw new ConflictException('Only a deactivated staff account can be restored.');
    }
    await this.prisma.staffAccount.update({ where: { id }, data: { status: 'ACTIVE' } });
  }

  // Someone must always be able to manage staff.
  private async assertAnotherSuperAdmin(): Promise<void> {
    const activeSuperAdmins = await this.prisma.staffAccount.count({
      where: { role: 'SUPER_ADMIN', status: 'ACTIVE' },
    });
    if (activeSuperAdmins <= 1) {
      throw new ConflictException('At least one active super admin must remain.');
    }
  }

  private async require(id: string): Promise<StaffAccount> {
    const staff = await this.findById(id);
    if (!staff) {
      throw new NotFoundException('Staff account not found.');
    }
    return staff;
  }
}
