import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { Env } from '@platform/config/env.schema';
import { PrismaService } from '@platform/database/prisma.service';
import { OrganizationService } from '@modules/iam/iam.public';
import { PAYMENT_GATEWAY, PaymentGatewayPort } from '../domain/ports/payment-gateway.port';

const DEFAULT_CURRENCY = 'USD';

export interface MoneyView {
  minorUnits: number;
  currency: string;
}

export interface WalletView {
  available: MoneyView;
  pending: MoneyView;
  held: MoneyView;
  lifetimeEarned: MoneyView;
  payoutConnected: boolean;
}

export interface CreatorLedgerEntryView {
  id: string;
  kind: 'earning' | 'withdrawal' | 'hold';
  description: string;
  /** Signed: positive for earnings, negative for money leaving the wallet. */
  amount: MoneyView;
  date: string;
  status: 'completed' | 'pending' | 'held';
}

export interface OrganizationLedgerEntryView {
  id: string;
  kind: 'topup' | 'campaign';
  description: string;
  /** Signed: positive for a top-up, negative when a campaign pays out. */
  amount: MoneyView;
  date: string;
}

export interface OrganizationTotals {
  monthlySpend: MoneyView;
  totalFunded: MoneyView;
}

/** Read models over the ledger for the wallet screens, plus creator payout onboarding. */
@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizations: OrganizationService,
    private readonly config: ConfigService<Env, true>,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGatewayPort,
  ) {}

  async getWallet(creatorUserId: string): Promise<WalletView> {
    const currency = await this.ownerCurrency('CREATOR', creatorUserId);
    const [balance, earned, open, payoutAccount] = await Promise.all([
      this.balanceMinor('CREATOR', creatorUserId, currency),
      this.sumEntries('CREATOR', creatorUserId, currency, 'CREDIT'),
      this.openWithdrawals(creatorUserId, currency),
      this.prisma.payoutAccount.findUnique({ where: { creatorUserId } }),
    ]);

    return {
      available: money(balance - open.requested - open.held, currency),
      pending: money(open.requested, currency),
      held: money(open.held, currency),
      lifetimeEarned: money(earned, currency),
      payoutConnected: payoutAccount
        ? await this.gateway.isPayoutAccountReady(payoutAccount.stripeAccountId)
        : false,
    };
  }

  async getCreatorLedger(creatorUserId: string): Promise<CreatorLedgerEntryView[]> {
    const [entries, withdrawals] = await Promise.all([
      this.prisma.ledgerEntry.findMany({
        where: { account: { ownerType: 'CREATOR', ownerId: creatorUserId } },
        include: { transaction: { select: { type: true } } },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      this.prisma.withdrawal.findMany({
        where: { creatorUserId, status: { in: ['REQUESTED', 'HELD'] } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const posted: CreatorLedgerEntryView[] = entries.map((entry) => {
      const credit = entry.direction === 'CREDIT';
      return {
        id: entry.id,
        kind: credit ? 'earning' : 'withdrawal',
        description: credit ? 'Campaign earnings' : 'Withdrawal',
        amount: money(credit ? entry.amount : -entry.amount, entry.currencyCode),
        date: entry.createdAt.toISOString(),
        status: 'completed',
      };
    });
    const inFlight: CreatorLedgerEntryView[] = withdrawals.map((withdrawal) => ({
      id: withdrawal.id,
      kind: withdrawal.status === 'HELD' ? 'hold' : 'withdrawal',
      description: withdrawal.status === 'HELD' ? 'Withdrawal on hold' : 'Withdrawal requested',
      amount: money(-withdrawal.amount, withdrawal.currencyCode),
      date: withdrawal.createdAt.toISOString(),
      status: withdrawal.status === 'HELD' ? 'held' : 'pending',
    }));

    return [...inFlight, ...posted].sort((a, b) => b.date.localeCompare(a.date));
  }

  async getOrganizationLedger(
    organizationId: string,
    requesterId: string,
  ): Promise<OrganizationLedgerEntryView[]> {
    await this.organizations.assertMember(organizationId, requesterId);
    const entries = await this.prisma.ledgerEntry.findMany({
      where: { account: { ownerType: 'ORGANIZATION', ownerId: organizationId } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return entries.map((entry) => {
      const credit = entry.direction === 'CREDIT';
      return {
        id: entry.id,
        kind: credit ? 'topup' : 'campaign',
        description: credit ? 'Campaign funding' : 'Creator payout',
        amount: money(credit ? entry.amount : -entry.amount, entry.currencyCode),
        date: entry.createdAt.toISOString(),
      };
    });
  }

  async organizationTotals(organizationId: string): Promise<OrganizationTotals> {
    const currency = await this.ownerCurrency('ORGANIZATION', organizationId);
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const [funded, spent] = await Promise.all([
      this.sumEntries('ORGANIZATION', organizationId, currency, 'CREDIT'),
      this.sumEntries('ORGANIZATION', organizationId, currency, 'DEBIT', monthStart),
    ]);
    return { monthlySpend: money(spent, currency), totalFunded: money(funded, currency) };
  }

  /** Starts (or resumes) Stripe Connect onboarding; returns the hosted URL to send the creator to. */
  async connectPayout(creatorUserId: string): Promise<{ url: string }> {
    const appUrl = this.config.get('APP_WEB_URL', { infer: true });
    const existing = await this.prisma.payoutAccount.findUnique({ where: { creatorUserId } });
    const onboarding = await this.gateway.createPayoutOnboarding({
      existingAccountId: existing?.stripeAccountId,
      returnUrl: `${appUrl}/creator/payout-method?payout=return`,
      refreshUrl: `${appUrl}/creator/payout-method?payout=refresh`,
      metadata: { creatorUserId },
    });
    if (!existing) {
      await this.prisma.payoutAccount.create({
        data: { creatorUserId, stripeAccountId: onboarding.accountId },
      });
    }
    return { url: onboarding.url };
  }

  private async ownerCurrency(
    ownerType: 'CREATOR' | 'ORGANIZATION',
    ownerId: string,
  ): Promise<string> {
    const account = await this.prisma.ledgerAccount.findFirst({
      where: { ownerType, ownerId },
      orderBy: { createdAt: 'desc' },
      select: { currencyCode: true },
    });
    return account?.currencyCode ?? DEFAULT_CURRENCY;
  }

  private async sumEntries(
    ownerType: 'CREATOR' | 'ORGANIZATION',
    ownerId: string,
    currencyCode: string,
    direction: 'CREDIT' | 'DEBIT',
    since?: Date,
  ): Promise<number> {
    const where: Prisma.LedgerEntryWhereInput = {
      direction,
      currencyCode,
      account: { ownerType, ownerId },
      ...(since ? { createdAt: { gte: since } } : {}),
    };
    const result = await this.prisma.ledgerEntry.aggregate({ _sum: { amount: true }, where });
    return result._sum.amount ?? 0;
  }

  private async balanceMinor(
    ownerType: 'CREATOR' | 'ORGANIZATION',
    ownerId: string,
    currencyCode: string,
  ): Promise<number> {
    const [credited, debited] = await Promise.all([
      this.sumEntries(ownerType, ownerId, currencyCode, 'CREDIT'),
      this.sumEntries(ownerType, ownerId, currencyCode, 'DEBIT'),
    ]);
    return credited - debited;
  }

  private async openWithdrawals(
    creatorUserId: string,
    currencyCode: string,
  ): Promise<{ requested: number; held: number }> {
    const groups = await this.prisma.withdrawal.groupBy({
      by: ['status'],
      where: { creatorUserId, currencyCode, status: { in: ['REQUESTED', 'HELD'] } },
      _sum: { amount: true },
    });
    const sum = (status: string) =>
      groups.find((group) => group.status === status)?._sum.amount ?? 0;
    return { requested: sum('REQUESTED'), held: sum('HELD') };
  }
}

function money(minorUnits: number, currency: string): MoneyView {
  return { minorUnits, currency };
}
