import { Money } from './money';

export type EntryDirection = 'DEBIT' | 'CREDIT';

export type LedgerTransactionType = 'CAMPAIGN_FUNDING' | 'EARNING_ACCRUAL' | 'WITHDRAWAL';

export interface PostingLine {
  accountId: string;
  direction: EntryDirection;
  amount: Money;
}

const MIN_LINES = 2;

/**
 * A balanced set of ledger postings. The core invariant — total debits equal
 * total credits, in a single currency — is enforced here, so no unbalanced
 * transaction can ever reach the database.
 */
export class LedgerTransaction {
  private constructor(
    readonly type: LedgerTransactionType,
    readonly reference: string | null,
    readonly lines: readonly PostingLine[],
  ) {}

  static create(
    type: LedgerTransactionType,
    reference: string | null,
    lines: PostingLine[],
  ): LedgerTransaction {
    if (lines.length < MIN_LINES) {
      throw new Error('A ledger transaction needs at least one debit and one credit.');
    }
    const currencyCode = lines[0].amount.currencyCode;
    const debits = LedgerTransaction.total(lines, 'DEBIT', currencyCode);
    const credits = LedgerTransaction.total(lines, 'CREDIT', currencyCode);
    if (debits.amountMinor !== credits.amountMinor) {
      throw new Error('Ledger transaction is unbalanced: debits must equal credits.');
    }
    return new LedgerTransaction(type, reference, lines);
  }

  private static total(
    lines: PostingLine[],
    direction: EntryDirection,
    currencyCode: string,
  ): Money {
    return lines
      .filter((line) => line.direction === direction)
      .reduce((sum, line) => sum.add(line.amount), Money.zero(currencyCode));
  }
}
