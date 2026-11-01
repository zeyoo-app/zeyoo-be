import { Money } from '../domain/money';
import { LedgerTransaction } from '../domain/ledger-transaction';
import { LedgerService } from './ledger.service';

/** Captures what the wallet operations post; LedgerTransaction itself rejects any imbalance. */
function build(): { service: LedgerService; posted: LedgerTransaction[] } {
  const posted: LedgerTransaction[] = [];
  const repository = {
    resolveAccountId: jest.fn(async (spec: { ownerType: string; systemKey: string | null }) =>
      spec.systemKey ?? spec.ownerType,
    ),
    post: jest.fn(async (transaction: LedgerTransaction) => {
      posted.push(transaction);
    }),
    balanceMinor: jest.fn(),
  };
  return { service: new LedgerService(repository as never), posted };
}

const lines = (transaction: LedgerTransaction): string[] =>
  transaction.lines.map((line) => `${line.direction} ${line.accountId} ${line.amount.amountMinor}`);

describe('LedgerService wallet postings', () => {
  it('a top-up credits the wallet from the platform funding source', async () => {
    const { service, posted } = build();

    await service.recordTopUp('org-1', Money.of(10_000, 'USD'), 'top-1');

    expect(posted[0].type).toBe('WALLET_TOPUP');
    expect(lines(posted[0])).toEqual([
      'CREDIT ORGANIZATION_WALLET 10000',
      'DEBIT PLATFORM_FUNDING_SOURCE 10000',
    ]);
  });

  it('wallet funding moves the budget to the campaign side and the fee to the platform', async () => {
    const { service, posted } = build();

    await service.recordWalletFunding('org-1', Money.of(50_000, 'USD'), Money.of(5_000, 'USD'), 'f-1');

    expect(posted[0].type).toBe('WALLET_FUNDING');
    expect(lines(posted[0])).toEqual([
      'DEBIT ORGANIZATION_WALLET 55000',
      'CREDIT ORGANIZATION 50000',
      'CREDIT PLATFORM_FEE_REVENUE 5000',
    ]);
  });

  it('unspent budget goes from the campaign side back to the wallet', async () => {
    const { service, posted } = build();

    await service.recordReturnToWallet('org-1', Money.of(15_000, 'USD'), 'r-1');

    expect(lines(posted[0])).toEqual(['DEBIT ORGANIZATION 15000', 'CREDIT ORGANIZATION_WALLET 15000']);
  });
});
