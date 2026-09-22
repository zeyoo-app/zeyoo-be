import { LedgerAccountOwnerType } from '@prisma/client';
import { LedgerTransaction } from '../ledger-transaction';

export const LEDGER_REPOSITORY = 'LedgerRepository';

export interface AccountSpec {
  ownerType: LedgerAccountOwnerType;
  ownerId: string | null;
  systemKey: string | null;
  currencyCode: string;
}

/**
 * Outbound port for ledger persistence. Implemented by the Prisma adapter.
 * Transactions are written atomically; balances are derived from entries.
 */
export interface LedgerRepository {
  resolveAccountId(spec: AccountSpec): Promise<string>;
  post(transaction: LedgerTransaction): Promise<void>;
  balanceMinor(accountId: string): Promise<number>;
}
