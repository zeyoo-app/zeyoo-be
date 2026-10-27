import { Injectable } from '@nestjs/common';
import { CampaignStatus, Prisma, UserStatus, UserType, WithdrawalStatus } from '@prisma/client';
import { PrismaService } from '@platform/database/prisma.service';
import { StaffService } from '@modules/iam/iam.public';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const OPEN_QUEUE_LIMIT = 200;
const RECENT_DAYS = 7;
const MS_PER_DAY = 86_400_000;

export interface PageQuery {
  page?: number;
  pageSize?: number;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

function paging(query: PageQuery): { page: number; pageSize: number; skip: number } {
  const pageSize = Math.min(Math.max(query.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const page = Math.max(query.page ?? 1, 1);
  return { page, pageSize, skip: (page - 1) * pageSize };
}

export interface MoneyTotal {
  currencyCode: string;
  amountMinor: number;
}

export interface AdminOverview {
  users: { creators: number; brands: number; suspended: number; joinedLast7Days: number };
  organizations: number;
  campaigns: { draft: number; published: number; closed: number };
  money: { funded: MoneyTotal[]; paidOut: MoneyTotal[]; creatorEarnings: MoneyTotal[] };
  queues: {
    withdrawalsRequested: number;
    withdrawalsHeld: number;
    disputesActive: number;
    fraudCasesOpen: number;
    verificationsPending: number;
  };
}

export interface AdminUserRow {
  id: string;
  email: string | null;
  phone: string | null;
  type: UserType;
  status: UserStatus;
  createdAt: Date;
  displayName: string | null;
  organizationName: string | null;
}

export interface AdminOrganizationRow {
  id: string;
  name: string;
  industry: string | null;
  website: string | null;
  createdAt: Date;
  ownerEmail: string | null;
  memberCount: number;
  campaignCount: number;
  funded: MoneyTotal[];
}

export interface AdminCampaignRow {
  id: string;
  title: string;
  organizationName: string;
  status: CampaignStatus;
  currencyCode: string;
  budgetMinor: number;
  fundedMinor: number;
  paidToCreatorsMinor: number;
  refundedMinor: number;
  /** Budget a closed or draft campaign has not spent and can still return to the brand. */
  refundableMinor: number;
  submissionCount: number;
  createdAt: Date;
  publishedAt: Date | null;
}

export interface AdminFundingRow {
  id: string;
  campaignTitle: string;
  organizationName: string;
  amountMinor: number;
  currencyCode: string;
  status: string;
  reference: string;
  createdAt: Date;
}

export interface AdminWithdrawalRow {
  id: string;
  creatorName: string;
  creatorEmail: string | null;
  amountMinor: number;
  currencyCode: string;
  status: WithdrawalStatus;
  holdReason: string | null;
  destinationAccountId: string | null;
  transferId: string | null;
  decidedByEmail: string | null;
  decidedAt: Date | null;
  createdAt: Date;
}

export interface AdminBilling {
  plans: {
    key: string;
    name: string;
    priceMinor: number;
    currencyCode: string;
    connectedToStripe: boolean;
    subscribers: number;
  }[];
  subscriptions: {
    id: string;
    organizationName: string;
    planName: string;
    status: string;
    since: Date;
  }[];
  summary: {
    active: number;
    pastDue: number;
    canceled: number;
    incomplete: number;
    organizationsWithCard: number;
  };
}

export interface AdminAuditRow {
  id: string;
  adminEmail: string | null;
  method: string;
  route: string;
  params: unknown;
  body: unknown;
  createdAt: Date;
}

export interface UserQuery extends PageQuery {
  search?: string;
  type?: UserType;
  status?: UserStatus;
}

function sumByCurrency(
  rows: { currencyCode: string; _sum: { amount: number | null } }[],
): MoneyTotal[] {
  return rows.map((row) => ({ currencyCode: row.currencyCode, amountMinor: row._sum.amount ?? 0 }));
}

/** Read-only reporting model for the admin console: joins that no single module owns. */
@Injectable()
export class AdminReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly staff: StaffService,
  ) {}

  async overview(): Promise<AdminOverview> {
    const since = new Date(Date.now() - RECENT_DAYS * MS_PER_DAY);
    const [
      creators,
      brands,
      suspended,
      joined,
      organizations,
      campaignGroups,
      funded,
      paidOut,
      earnings,
      requested,
      held,
      disputes,
      fraud,
      verifications,
    ] = await Promise.all([
      this.prisma.user.count({ where: { type: 'CREATOR', status: { not: 'DELETED' } } }),
      this.prisma.user.count({ where: { type: 'BRAND_USER', status: { not: 'DELETED' } } }),
      this.prisma.user.count({ where: { status: 'SUSPENDED' } }),
      this.prisma.user.count({ where: { createdAt: { gte: since }, status: { not: 'DELETED' } } }),
      this.prisma.organization.count(),
      this.prisma.campaign.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.campaignFunding.groupBy({
        by: ['currencyCode'],
        where: { status: 'SUCCEEDED' },
        _sum: { amount: true },
      }),
      this.prisma.withdrawal.groupBy({
        by: ['currencyCode'],
        where: { status: 'PAID' },
        _sum: { amount: true },
      }),
      this.prisma.campaign.findMany({
        select: { currencyCode: true, id: true },
      }),
      this.prisma.withdrawal.count({ where: { status: 'REQUESTED' } }),
      this.prisma.withdrawal.count({ where: { status: 'HELD' } }),
      this.prisma.dispute.count({ where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } } }),
      this.prisma.fraudCase.count({ where: { status: 'OPEN' } }),
      this.prisma.creatorProfile.count({ where: { verificationStatus: 'PENDING' } }),
    ]);
    const countOf = (status: CampaignStatus): number =>
      campaignGroups.find((group) => group.status === status)?._count._all ?? 0;
    return {
      users: { creators, brands, suspended, joinedLast7Days: joined },
      organizations,
      campaigns: {
        draft: countOf('DRAFT'),
        published: countOf('PUBLISHED'),
        closed: countOf('CLOSED'),
      },
      money: {
        funded: sumByCurrency(funded),
        paidOut: sumByCurrency(paidOut),
        creatorEarnings: await this.creatorEarningTotals(earnings),
      },
      queues: {
        withdrawalsRequested: requested,
        withdrawalsHeld: held,
        disputesActive: disputes,
        fraudCasesOpen: fraud,
        verificationsPending: verifications,
      },
    };
  }

  async users(query: UserQuery): Promise<Page<AdminUserRow>> {
    const { page, pageSize, skip } = paging(query);
    const search = query.search?.trim();
    const where: Prisma.UserWhereInput = {
      ...(query.type ? { type: query.type } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(search
        ? {
            OR: [
              { email: { contains: search, mode: 'insensitive' } },
              { phone: { contains: search } },
            ],
          }
        : {}),
    };
    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: pageSize }),
    ]);
    const ids = users.map((user) => user.id);
    const [profiles, memberships] = await Promise.all([
      this.prisma.creatorProfile.findMany({
        where: { userId: { in: ids } },
        select: { userId: true, displayName: true },
      }),
      this.prisma.membership.findMany({
        where: { userId: { in: ids } },
        include: { organization: { select: { name: true } } },
      }),
    ]);
    const names = new Map(profiles.map((profile) => [profile.userId, profile.displayName]));
    const orgs = new Map(memberships.map((row) => [row.userId, row.organization.name]));
    const items = users.map((user) => ({
      id: user.id,
      email: user.email,
      phone: user.phone,
      type: user.type,
      status: user.status,
      createdAt: user.createdAt,
      displayName: names.get(user.id) ?? null,
      organizationName: orgs.get(user.id) ?? null,
    }));
    return { items, total, page, pageSize };
  }

  async organizations(query: PageQuery): Promise<Page<AdminOrganizationRow>> {
    const { page, pageSize, skip } = paging(query);
    const total = await this.prisma.organization.count();
    const organizations = await this.prisma.organization.findMany({
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
      include: {
        memberships: { include: { user: { select: { email: true } } } },
        _count: { select: { campaigns: true } },
      },
    });
    const funded = await this.prisma.campaignFunding.groupBy({
      by: ['organizationId', 'currencyCode'],
      where: { status: 'SUCCEEDED', organizationId: { in: organizations.map((org) => org.id) } },
      _sum: { amount: true },
    });
    const items = organizations.map((org) => ({
      id: org.id,
      name: org.name,
      industry: org.industry,
      website: org.website,
      createdAt: org.createdAt,
      ownerEmail: org.memberships.find((member) => member.role === 'OWNER')?.user.email ?? null,
      memberCount: org.memberships.length,
      campaignCount: org._count.campaigns,
      funded: funded
        .filter((row) => row.organizationId === org.id)
        .map((row) => ({ currencyCode: row.currencyCode, amountMinor: row._sum.amount ?? 0 })),
    }));
    return { items, total, page, pageSize };
  }

  async campaigns(
    query: PageQuery & { status?: CampaignStatus; search?: string },
  ): Promise<Page<AdminCampaignRow>> {
    const { page, pageSize, skip } = paging(query);
    const term = query.search?.trim();
    const where: Prisma.CampaignWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(term ? { title: { contains: term, mode: 'insensitive' } } : {}),
    };
    const [total, campaigns] = await Promise.all([
      this.prisma.campaign.count({ where }),
      this.prisma.campaign.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        include: { organization: { select: { name: true } } },
      }),
    ]);
    const ids = campaigns.map((campaign) => campaign.id);
    const [fundings, refunds, earnings, submissions] = await Promise.all([
      this.prisma.campaignFunding.groupBy({
        by: ['campaignId'],
        where: { campaignId: { in: ids }, status: 'SUCCEEDED' },
        _sum: { amount: true },
      }),
      this.prisma.campaignRefund.groupBy({
        by: ['campaignId'],
        where: { campaignId: { in: ids }, status: { in: ['PENDING', 'SUCCEEDED'] } },
        _sum: { amount: true },
      }),
      this.prisma.creatorEarning.groupBy({
        by: ['campaignId'],
        where: { campaignId: { in: ids } },
        _sum: { accruedAmount: true },
      }),
      this.prisma.submission.groupBy({
        by: ['campaignId'],
        where: { campaignId: { in: ids } },
        _count: { _all: true },
      }),
    ]);
    const items = campaigns.map((campaign) => {
      const funded = fundings.find((row) => row.campaignId === campaign.id)?._sum.amount ?? 0;
      const refunded = refunds.find((row) => row.campaignId === campaign.id)?._sum.amount ?? 0;
      const paid = earnings.find((row) => row.campaignId === campaign.id)?._sum.accruedAmount ?? 0;
      return {
        id: campaign.id,
        title: campaign.title,
        organizationName: campaign.organization.name,
        status: campaign.status,
        currencyCode: campaign.currencyCode,
        budgetMinor: campaign.budgetAmount,
        fundedMinor: funded,
        paidToCreatorsMinor: paid,
        refundedMinor: refunded,
        refundableMinor:
          campaign.status === 'PUBLISHED' ? 0 : Math.max(0, funded - refunded - paid),
        submissionCount:
          submissions.find((row) => row.campaignId === campaign.id)?._count._all ?? 0,
        createdAt: campaign.createdAt,
        publishedAt: campaign.publishedAt,
      };
    });
    return { items, total, page, pageSize };
  }

  async fundings(query: PageQuery): Promise<Page<AdminFundingRow>> {
    const { page, pageSize, skip } = paging(query);
    const [total, fundings] = await Promise.all([
      this.prisma.campaignFunding.count(),
      this.prisma.campaignFunding.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
    ]);
    const [campaigns, organizations] = await Promise.all([
      this.prisma.campaign.findMany({
        where: { id: { in: fundings.map((row) => row.campaignId) } },
        select: { id: true, title: true },
      }),
      this.prisma.organization.findMany({
        where: { id: { in: fundings.map((row) => row.organizationId) } },
        select: { id: true, name: true },
      }),
    ]);
    const titles = new Map(campaigns.map((row) => [row.id, row.title]));
    const orgNames = new Map(organizations.map((row) => [row.id, row.name]));
    const items = fundings.map((row) => ({
      id: row.id,
      campaignTitle: titles.get(row.campaignId) ?? 'Campaign',
      organizationName: orgNames.get(row.organizationId) ?? 'Organization',
      amountMinor: row.amount,
      currencyCode: row.currencyCode,
      status: row.status,
      reference: row.stripePaymentIntentId,
      createdAt: row.createdAt,
    }));
    return { items, total, page, pageSize };
  }

  async withdrawals(
    scope: 'open' | 'history',
    query: PageQuery,
  ): Promise<Page<AdminWithdrawalRow>> {
    const { page, pageSize, skip } = paging(query);
    const where: Prisma.WithdrawalWhereInput =
      scope === 'open'
        ? { status: { in: ['REQUESTED', 'HELD'] } }
        : { status: { in: ['PAID', 'REJECTED'] } };
    const [total, rows] = await Promise.all([
      this.prisma.withdrawal.count({ where }),
      this.prisma.withdrawal.findMany({
        where,
        orderBy: { createdAt: scope === 'open' ? 'asc' : 'desc' },
        skip: scope === 'open' ? 0 : skip,
        take: scope === 'open' ? OPEN_QUEUE_LIMIT : pageSize,
      }),
    ]);
    const userIds = [
      ...new Set(
        rows.flatMap((row) => [row.creatorUserId, row.decidedByUserId].filter(Boolean) as string[]),
      ),
    ];
    const [users, profiles] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, email: true },
      }),
      this.prisma.creatorProfile.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, displayName: true },
      }),
    ]);
    const emails = new Map(users.map((user) => [user.id, user.email]));
    const names = new Map(profiles.map((profile) => [profile.userId, profile.displayName]));
    const deciders = await this.staff.emailsByIds(
      rows.map((row) => row.decidedByUserId).filter(Boolean) as string[],
    );
    const items = rows.map((row) => ({
      id: row.id,
      creatorName: names.get(row.creatorUserId) ?? emails.get(row.creatorUserId) ?? 'Creator',
      creatorEmail: emails.get(row.creatorUserId) ?? null,
      amountMinor: row.amount,
      currencyCode: row.currencyCode,
      status: row.status,
      holdReason: row.holdReason,
      destinationAccountId: row.destinationAccountId,
      transferId: row.stripePayoutId,
      decidedByEmail: row.decidedByUserId
        ? (deciders.get(row.decidedByUserId) ?? emails.get(row.decidedByUserId) ?? null)
        : null,
      decidedAt: row.decidedAt,
      createdAt: row.createdAt,
    }));
    return { items, total, page, pageSize };
  }

  async auditLog(query: PageQuery): Promise<Page<AdminAuditRow>> {
    const { page, pageSize, skip } = paging(query);
    const [total, rows] = await Promise.all([
      this.prisma.adminAuditLog.count(),
      this.prisma.adminAuditLog.findMany({ orderBy: { createdAt: 'desc' }, skip, take: pageSize }),
    ]);
    // Actions are by staff accounts; older ones were by ADMIN-type users.
    const actorIds = [...new Set(rows.map((row) => row.adminUserId))];
    const [staffEmails, admins] = await Promise.all([
      this.staff.emailsByIds(actorIds),
      this.prisma.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, email: true },
      }),
    ]);
    const emails = new Map(admins.map((admin) => [admin.id, admin.email]));
    const items = rows.map((row) => ({
      id: row.id,
      adminEmail: staffEmails.get(row.adminUserId) ?? emails.get(row.adminUserId) ?? null,
      method: row.method,
      route: row.route,
      params: row.params,
      body: row.body,
      createdAt: row.createdAt,
    }));
    return { items, total, page, pageSize };
  }

  private async creatorEarningTotals(
    campaigns: { currencyCode: string; id: string }[],
  ): Promise<MoneyTotal[]> {
    const earnings = await this.prisma.creatorEarning.groupBy({
      by: ['campaignId'],
      _sum: { accruedAmount: true },
    });
    const currencyOf = new Map(campaigns.map((campaign) => [campaign.id, campaign.currencyCode]));
    const totals = new Map<string, number>();
    for (const row of earnings) {
      const currency = currencyOf.get(row.campaignId) ?? 'USD';
      totals.set(currency, (totals.get(currency) ?? 0) + (row._sum.accruedAmount ?? 0));
    }
    return [...totals].map(([currencyCode, amountMinor]) => ({ currencyCode, amountMinor }));
  }

  async billing(): Promise<AdminBilling> {
    const [plans, subscriptions, cards] = await Promise.all([
      this.prisma.plan.findMany({ orderBy: { priceMinor: 'asc' } }),
      this.prisma.subscription.findMany({ orderBy: { createdAt: 'desc' } }),
      this.prisma.billingPaymentMethod.count(),
    ]);
    const organizations = await this.prisma.organization.findMany({
      where: { id: { in: subscriptions.map((row) => row.organizationId) } },
      select: { id: true, name: true },
    });
    const names = new Map(organizations.map((org) => [org.id, org.name]));
    const planNames = new Map(plans.map((plan) => [plan.key, plan.name]));
    const count = (status: string): number =>
      subscriptions.filter((row) => row.status === status).length;
    return {
      plans: plans.map((plan) => ({
        key: plan.key,
        name: plan.name,
        priceMinor: plan.priceMinor,
        currencyCode: plan.currencyCode,
        connectedToStripe: plan.stripePriceId !== null,
        subscribers: subscriptions.filter(
          (row) => row.planKey === plan.key && row.status === 'ACTIVE',
        ).length,
      })),
      subscriptions: subscriptions.map((row) => ({
        id: row.id,
        organizationName: names.get(row.organizationId) ?? 'Organization',
        planName: planNames.get(row.planKey) ?? row.planKey,
        status: row.status,
        since: row.createdAt,
      })),
      summary: {
        active: count('ACTIVE'),
        pastDue: count('PAST_DUE'),
        canceled: count('CANCELED'),
        incomplete: count('INCOMPLETE'),
        organizationsWithCard: cards,
      },
    };
  }
}
