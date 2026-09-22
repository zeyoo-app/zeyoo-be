import { LedgerTransaction, PostingLine } from './ledger-transaction';
import { Money } from './money';

function line(accountId: string, direction: PostingLine['direction'], minor: number): PostingLine {
  return { accountId, direction, amount: Money.of(minor, 'USD') };
}

describe('LedgerTransaction', () => {
  it('accepts a balanced set of postings', () => {
    const transaction = LedgerTransaction.create('CAMPAIGN_FUNDING', 'funding-1', [
      line('org', 'CREDIT', 10_000),
      line('platform', 'DEBIT', 10_000),
    ]);

    expect(transaction.lines).toHaveLength(2);
  });

  it('rejects an unbalanced set of postings', () => {
    expect(() =>
      LedgerTransaction.create('CAMPAIGN_FUNDING', 'funding-1', [
        line('org', 'CREDIT', 10_000),
        line('platform', 'DEBIT', 9_000),
      ]),
    ).toThrow(/unbalanced/);
  });

  it('requires at least two postings', () => {
    expect(() =>
      LedgerTransaction.create('CAMPAIGN_FUNDING', 'funding-1', [line('org', 'CREDIT', 10_000)]),
    ).toThrow();
  });
});
