import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { UserStatus, UserType, VerificationStatus } from '@prisma/client';
import { PrismaService } from '@platform/database/prisma.service';
import { CreatorProfileService } from '@modules/creators/creators.public';
import { UserService } from '@modules/iam/iam.public';
import { WalletService } from '@modules/payments/payments.public';
import { Page, PageQuery } from './admin-read.service';

const DEFAULT_PAGE_SIZE = 25;
const RECENT = 10;

export interface MoneyAmount {
  minorUnits: number;
  currency: string;
}

export interface VerificationRow {
  userId: string;
  displayName: string;
  username: string;
  email: string | null;
  country: string | null;
  headline: string | null;
  bio: string | null;
  requestedAt: Date;
  accounts: { platform: string; handle: string; verified: boolean }[];
}

export interface StaffRow {
  id: string;
  email: string | null;
  status: UserStatus;
  createdAt: Date;
  isYou: boolean;
}

export interface UserDetail {
  user: {
    id: string;
    email: string | null;
    phone: string | null;
    type: UserType;
    status: UserStatus;
    emailVerified: boolean;
    createdAt: Date;
  };
  creator: {
    displayName: string;
    username: string;
    country: string | null;
    headline: string | null;
    bio: string | null;
    verificationStatus: VerificationStatus;
    verificationNote: string | null;
    accounts: { platform: string; handle: string; verified: boolean }[];
    payoutConnected: boolean;
    wallet: {
      available: MoneyAmount;
      pending: MoneyAmount;
      held: MoneyAmount;
      lifetimeEarned: MoneyAmount;
    } | null;
    submissions: { total: number; approved: number };
    earnings: {
      campaignTitle: string;
      accruedMinor: number;
      currencyCode: string;
      paused: boolean;
    }[];
    withdrawals: {
      id: string;
      amountMinor: number;
      currencyCode: string;
      status: string;
      createdAt: Date;
    }[];
  } | null;
  organizations: {
    id: string;
    name: string;
    role: string;
    campaignCount: number;
    funded: { currencyCode: string; amountMinor: number }[];
    subscription: { planKey: string; status: string } | null;
  }[];
  disputes: { id: string; subjectType: string; status: string; reason: string; createdAt: Date }[];
  fraudCases: {
    id: string;
    campaignTitle: string;
    level: string;
    status: string;
    createdAt: Date;
  }[];
}

/** People-centred admin reads and staff management. */
@Injectable()
export class AdminPeopleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserService,
    private readonly profiles: CreatorProfileService,
    private readonly wallets: WalletService,
  ) {}

  async verifications(query: PageQuery): Promise<Page<VerificationRow>> {
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const page = Math.max(query.page ?? 1, 1);
    const where = { verificationStatus: 'PENDING' as const };
    const [total, profiles] = await Promise.all([
      this.prisma.creatorProfile.count({ where }),
      this.prisma.creatorProfile.findMany({
        where,
        orderBy: { updatedAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { socialAccounts: { where: { status: 'CONNECTED' } } },
      }),
    ]);
    const users = await this.prisma.user.findMany({
      where: { id: { in: profiles.map((profile) => profile.userId) } },
      select: { id: true, email: true },
    });
    const emails = new Map(users.map((user) => [user.id, user.email]));
    const items = profiles.map((profile) => ({
      userId: profile.userId,
      displayName: profile.displayName,
      username: profile.username,
      email: emails.get(profile.userId) ?? null,
      country: profile.country,
      headline: profile.headline,
      bio: profile.bio,
      requestedAt: profile.updatedAt,
      accounts: profile.socialAccounts.map((account) => ({
        platform: account.platform,
        handle: account.handle,
        verified: account.verifiedAt !== null,
      })),
    }));
    return { items, total, page, pageSize };
  }

  approveVerification(userId: string): Promise<unknown> {
    return this.profiles.reviewVerification(userId, 'VERIFIED', null);
  }

  rejectVerification(userId: string, note: string): Promise<unknown> {
    return this.profiles.reviewVerification(userId, 'REJECTED', note);
  }

  async userDetail(userId: string): Promise<UserDetail> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found.');
    }
    const [profile, memberships, disputes, fraudCases] = await Promise.all([
      this.prisma.creatorProfile.findUnique({
        where: { userId },
        include: { socialAccounts: { where: { status: 'CONNECTED' } } },
      }),
      this.prisma.membership.findMany({
        where: { userId },
        include: { organization: { select: { id: true, name: true } } },
      }),
      this.prisma.dispute.findMany({
        where: { openedByUserId: userId },
        orderBy: { createdAt: 'desc' },
        take: RECENT,
      }),
      this.prisma.fraudCase.findMany({
        where: { creatorUserId: userId },
        orderBy: { createdAt: 'desc' },
        take: RECENT,
      }),
    ]);
    const fraudCampaigns = await this.titles(fraudCases.map((item) => item.campaignId));
    return {
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        type: user.type,
        status: user.status,
        emailVerified: user.emailVerifiedAt !== null || user.phoneVerifiedAt !== null,
        createdAt: user.createdAt,
      },
      creator: profile ? await this.creatorSection(userId, profile) : null,
      organizations: await Promise.all(
        memberships.map((membership) => this.organizationSection(membership)),
      ),
      disputes: disputes.map((item) => ({
        id: item.id,
        subjectType: item.subjectType,
        status: item.status,
        reason: item.reason,
        createdAt: item.createdAt,
      })),
      fraudCases: fraudCases.map((item) => ({
        id: item.id,
        campaignTitle: fraudCampaigns.get(item.campaignId) ?? 'Campaign',
        level: item.level,
        status: item.status,
        createdAt: item.createdAt,
      })),
    };
  }

  async staff(requesterId: string): Promise<StaffRow[]> {
    const admins = await this.prisma.user.findMany({
      where: { type: 'ADMIN', status: { not: 'DELETED' } },
      orderBy: { createdAt: 'asc' },
    });
    return admins.map((admin) => ({
      id: admin.id,
      email: admin.email,
      status: admin.status,
      createdAt: admin.createdAt,
      isYou: admin.id === requesterId,
    }));
  }

  /** Gives a person staff access: a brand-new account, or an existing one with no other role. */
  async addStaff(email: string): Promise<StaffRow> {
    const normalized = email.trim().toLowerCase();
    const existing = await this.users.findByEmail(normalized);
    if (!existing) {
      const created = await this.users.createWithEmail({ email: normalized, type: 'ADMIN' });
      return this.toStaff(created.id, created.email, created.status, created.createdAt);
    }
    if (existing.type === 'ADMIN') {
      throw new ConflictException('This person already has staff access.');
    }
    const [profile, memberships] = await Promise.all([
      this.prisma.creatorProfile.count({ where: { userId: existing.id } }),
      this.prisma.membership.count({ where: { userId: existing.id } }),
    ]);
    if (profile > 0 || memberships > 0) {
      throw new ConflictException(
        'This email belongs to a creator or brand account. Use a separate email for staff access.',
      );
    }
    const promoted = await this.users.setType(existing.id, 'ADMIN');
    const active = await this.users.setStatus(promoted.id, 'ACTIVE');
    return this.toStaff(active.id, active.email, active.status, active.createdAt);
  }

  async deactivateStaff(userId: string, requesterId: string): Promise<void> {
    const staff = await this.requireStaff(userId);
    if (staff.id === requesterId) {
      throw new ConflictException('You cannot remove your own access.');
    }
    if (staff.status !== 'ACTIVE') {
      throw new ConflictException('This staff account is not active.');
    }
    const activeAdmins = await this.prisma.user.count({
      where: { type: 'ADMIN', status: 'ACTIVE' },
    });
    if (activeAdmins <= 1) {
      throw new ConflictException('At least one active staff account must remain.');
    }
    await this.users.setStatus(userId, 'SUSPENDED');
  }

  async reactivateStaff(userId: string): Promise<void> {
    const staff = await this.requireStaff(userId);
    if (staff.status !== 'SUSPENDED') {
      throw new ConflictException('Only a deactivated staff account can be restored.');
    }
    await this.users.setStatus(userId, 'ACTIVE');
  }

  private toStaff(id: string, email: string | null, status: UserStatus, createdAt: Date): StaffRow {
    return { id, email, status, createdAt, isYou: false };
  }

  private async requireStaff(userId: string): Promise<{ id: string; status: UserStatus }> {
    const user = await this.users.findById(userId);
    if (!user || user.type !== 'ADMIN') {
      throw new NotFoundException('Staff account not found.');
    }
    return { id: user.id, status: user.status };
  }

  private async creatorSection(
    userId: string,
    profile: {
      displayName: string;
      username: string;
      country: string | null;
      headline: string | null;
      bio: string | null;
      verificationStatus: VerificationStatus;
      verificationNote: string | null;
      socialAccounts: { platform: string; handle: string; verifiedAt: Date | null }[];
    },
  ): Promise<NonNullable<UserDetail['creator']>> {
    const [wallet, payoutAccount, submissionGroups, earnings, withdrawals] = await Promise.all([
      this.wallets.getWallet(userId).catch(() => null),
      this.prisma.payoutAccount.findUnique({ where: { creatorUserId: userId } }),
      this.prisma.submission.groupBy({
        by: ['status'],
        where: { creatorUserId: userId },
        _count: { _all: true },
      }),
      this.prisma.creatorEarning.findMany({ where: { creatorUserId: userId } }),
      this.prisma.withdrawal.findMany({
        where: { creatorUserId: userId },
        orderBy: { createdAt: 'desc' },
        take: RECENT,
      }),
    ]);
    const campaignIds = earnings.map((earning) => earning.campaignId);
    const [campaigns, paused] = await Promise.all([
      this.prisma.campaign.findMany({
        where: { id: { in: campaignIds } },
        select: { id: true, title: true, currencyCode: true },
      }),
      this.prisma.fraudCase.findMany({
        where: {
          creatorUserId: userId,
          campaignId: { in: campaignIds },
          status: { in: ['OPEN', 'RESOLVED'] },
        },
        select: { campaignId: true },
      }),
    ]);
    const pausedIds = new Set(paused.map((item) => item.campaignId));
    const total = submissionGroups.reduce((sum, group) => sum + group._count._all, 0);
    const approved =
      submissionGroups.find((group) => group.status === 'APPROVED')?._count._all ?? 0;
    return {
      displayName: profile.displayName,
      username: profile.username,
      country: profile.country,
      headline: profile.headline,
      bio: profile.bio,
      verificationStatus: profile.verificationStatus,
      verificationNote: profile.verificationNote,
      accounts: profile.socialAccounts.map((account) => ({
        platform: account.platform,
        handle: account.handle,
        verified: account.verifiedAt !== null,
      })),
      payoutConnected: payoutAccount !== null,
      wallet: wallet
        ? {
            available: wallet.available,
            pending: wallet.pending,
            held: wallet.held,
            lifetimeEarned: wallet.lifetimeEarned,
          }
        : null,
      submissions: { total, approved },
      earnings: earnings.map((earning) => {
        const campaign = campaigns.find((item) => item.id === earning.campaignId);
        return {
          campaignTitle: campaign?.title ?? 'Campaign',
          accruedMinor: earning.accruedAmount,
          currencyCode: campaign?.currencyCode ?? 'USD',
          paused: pausedIds.has(earning.campaignId),
        };
      }),
      withdrawals: withdrawals.map((item) => ({
        id: item.id,
        amountMinor: item.amount,
        currencyCode: item.currencyCode,
        status: item.status,
        createdAt: item.createdAt,
      })),
    };
  }

  private async organizationSection(membership: {
    role: string;
    organization: { id: string; name: string };
  }): Promise<UserDetail['organizations'][number]> {
    const organizationId = membership.organization.id;
    const [campaignCount, funded, subscription] = await Promise.all([
      this.prisma.campaign.count({ where: { organizationId } }),
      this.prisma.campaignFunding.groupBy({
        by: ['currencyCode'],
        where: { organizationId, status: 'SUCCEEDED' },
        _sum: { amount: true },
      }),
      this.prisma.subscription.findUnique({ where: { organizationId } }),
    ]);
    return {
      id: organizationId,
      name: membership.organization.name,
      role: membership.role,
      campaignCount,
      funded: funded.map((row) => ({
        currencyCode: row.currencyCode,
        amountMinor: row._sum.amount ?? 0,
      })),
      subscription: subscription
        ? { planKey: subscription.planKey, status: subscription.status }
        : null,
    };
  }

  private async titles(campaignIds: string[]): Promise<Map<string, string>> {
    const campaigns = await this.prisma.campaign.findMany({
      where: { id: { in: campaignIds } },
      select: { id: true, title: true },
    });
    return new Map(campaigns.map((campaign) => [campaign.id, campaign.title]));
  }
}
