import { Inject, Injectable } from '@nestjs/common';
import { LedgerAccountOwnerType } from '@prisma/client';
import {
  PLATFORM_FEE_REVENUE,
  PLATFORM_FUNDING_SOURCE,
  PLATFORM_PAYOUT_SOURCE,
} from '../domain/ledger-accounts';
import {
  LedgerTransaction,
  LedgerTransactionType,
  PostingLine,
} from '../domain/ledger-transaction';
import { Money } from '../domain/money';
import {
  AccountSpec,
  LEDGER_REPOSITORY,
  LedgerRepository,
} from '../domain/ports/ledger.repository';

@Injectable()
export class LedgerService {
  constructor(@Inject(LEDGER_REPOSITORY) private readonly ledger: LedgerRepository) {}

  async recordFunding(organizationId: string, amount: Money, reference: string): Promise<void> {
    await this.postBalanced('CAMPAIGN_FUNDING', reference, [
      { spec: this.orgAccount(organizationId, amount.currencyCode), direction: 'CREDIT', amount },
      { spec: this.platformFundingSource(amount.currencyCode), direction: 'DEBIT', amount },
    ]);
  }

  /** Returns unspent budget: the reverse of a funding posting. */
  async recordRefund(organizationId: string, amount: Money, reference: string): Promise<void> {
    await this.postBalanced('CAMPAIGN_REFUND', reference, [
      { spec: this.orgAccount(organizationId, amount.currencyCode), direction: 'DEBIT', amount },
      { spec: this.platformFundingSource(amount.currencyCode), direction: 'CREDIT', amount },
    ]);
  }

  /** A card payment into the brand's wallet. */
  async recordTopUp(organizationId: string, amount: Money, reference: string): Promise<void> {
    await this.postBalanced('WALLET_TOPUP', reference, [
      { spec: this.walletAccount(organizationId, amount.currencyCode), direction: 'CREDIT', amount },
      { spec: this.platformFundingSource(amount.currencyCode), direction: 'DEBIT', amount },
    ]);
  }

  /**
   * Pays a campaign from the wallet: the budget becomes the brand's committed campaign
   * money (as a card funding would), and the plan fee goes to the platform.
   */
  async recordWalletFunding(
    organizationId: string,
    budget: Money,
    fee: Money,
    reference: string,
  ): Promise<void> {
    const total = Money.of(budget.amountMinor + fee.amountMinor, budget.currencyCode);
    await this.postBalanced('WALLET_FUNDING', reference, [
      { spec: this.walletAccount(organizationId, budget.currencyCode), direction: 'DEBIT', amount: total },
      { spec: this.orgAccount(organizationId, budget.currencyCode), direction: 'CREDIT', amount: budget },
      ...(fee.amountMinor > 0
        ? [{ spec: this.platformFeeRevenue(fee.currencyCode), direction: 'CREDIT' as const, amount: fee }]
        : []),
    ]);
  }

  /** A closed campaign's unspent budget goes back into the brand's wallet. */
  async recordReturnToWallet(organizationId: string, amount: Money, reference: string): Promise<void> {
    await this.postBalanced('WALLET_RETURN', reference, [
      { spec: this.orgAccount(organizationId, amount.currencyCode), direction: 'DEBIT', amount },
      { spec: this.walletAccount(organizationId, amount.currencyCode), direction: 'CREDIT', amount },
    ]);
  }

  async walletBalanceMinor(organizationId: string, currencyCode: string): Promise<number> {
    const accountId = await this.ledger.resolveAccountId(
      this.walletAccount(organizationId, currencyCode),
    );
    return this.ledger.balanceMinor(accountId);
  }

  async recordEarning(
    organizationId: string,
    creatorUserId: string,
    amount: Money,
    reference: string,
  ): Promise<void> {
    await this.postBalanced('EARNING_ACCRUAL', reference, [
      { spec: this.orgAccount(organizationId, amount.currencyCode), direction: 'DEBIT', amount },
      {
        spec: this.creatorAccount(creatorUserId, amount.currencyCode),
        direction: 'CREDIT',
        amount,
      },
    ]);
  }

  async recordWithdrawal(creatorUserId: string, amount: Money, reference: string): Promise<void> {
    await this.postBalanced('WITHDRAWAL', reference, [
      { spec: this.creatorAccount(creatorUserId, amount.currencyCode), direction: 'DEBIT', amount },
      { spec: this.platformPayoutSource(amount.currencyCode), direction: 'CREDIT', amount },
    ]);
  }

  async creatorBalanceMinor(creatorUserId: string, currencyCode: string): Promise<number> {
    const accountId = await this.ledger.resolveAccountId(
      this.creatorAccount(creatorUserId, currencyCode),
    );
    return this.ledger.balanceMinor(accountId);
  }

  private async postBalanced(
    type: LedgerTransactionType,
    reference: string,
    postings: { spec: AccountSpec; direction: PostingLine['direction']; amount: Money }[],
  ): Promise<void> {
    const lines = await Promise.all(
      postings.map(async (posting) => ({
        accountId: await this.ledger.resolveAccountId(posting.spec),
        direction: posting.direction,
        amount: posting.amount,
      })),
    );
    await this.ledger.post(LedgerTransaction.create(type, reference, lines));
  }

  private orgAccount(organizationId: string, currencyCode: string): AccountSpec {
    return this.ownerAccount('ORGANIZATION', organizationId, currencyCode);
  }

  private walletAccount(organizationId: string, currencyCode: string): AccountSpec {
    return this.ownerAccount('ORGANIZATION_WALLET', organizationId, currencyCode);
  }

  private creatorAccount(creatorUserId: string, currencyCode: string): AccountSpec {
    return this.ownerAccount('CREATOR', creatorUserId, currencyCode);
  }

  private ownerAccount(
    ownerType: LedgerAccountOwnerType,
    ownerId: string,
    currencyCode: string,
  ): AccountSpec {
    return { ownerType, ownerId, systemKey: null, currencyCode };
  }

  private platformFundingSource(currencyCode: string): AccountSpec {
    return {
      ownerType: 'PLATFORM',
      ownerId: null,
      systemKey: PLATFORM_FUNDING_SOURCE,
      currencyCode,
    };
  }

  private platformFeeRevenue(currencyCode: string): AccountSpec {
    return {
      ownerType: 'PLATFORM',
      ownerId: null,
      systemKey: PLATFORM_FEE_REVENUE,
      currencyCode,
    };
  }

  private platformPayoutSource(currencyCode: string): AccountSpec {
    return {
      ownerType: 'PLATFORM',
      ownerId: null,
      systemKey: PLATFORM_PAYOUT_SOURCE,
      currencyCode,
    };
  }
}
