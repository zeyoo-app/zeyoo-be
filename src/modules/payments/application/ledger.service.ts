import { Inject, Injectable } from '@nestjs/common';
import { LedgerAccountOwnerType } from '@prisma/client';
import { PLATFORM_FUNDING_SOURCE, PLATFORM_PAYOUT_SOURCE } from '../domain/ledger-accounts';
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

  private platformPayoutSource(currencyCode: string): AccountSpec {
    return {
      ownerType: 'PLATFORM',
      ownerId: null,
      systemKey: PLATFORM_PAYOUT_SOURCE,
      currencyCode,
    };
  }
}
