import { Injectable } from '@nestjs/common';
import { PrismaService } from '@platform/database/prisma.service';
import { LedgerTransaction } from '../domain/ledger-transaction';
import { AccountSpec, LedgerRepository } from '../domain/ports/ledger.repository';

@Injectable()
export class PrismaLedgerRepository implements LedgerRepository {
  constructor(private readonly prisma: PrismaService) {}

  async resolveAccountId(spec: AccountSpec): Promise<string> {
    if (spec.systemKey) {
      return this.resolvePlatformAccount(spec.systemKey, spec.currencyCode);
    }
    const { ownerId } = spec;
    if (ownerId === null) {
      throw new Error('A non-platform ledger account requires an owner id.');
    }
    const account = await this.prisma.ledgerAccount.upsert({
      where: {
        ownerType_ownerId_currencyCode: {
          ownerType: spec.ownerType,
          ownerId,
          currencyCode: spec.currencyCode,
        },
      },
      update: {},
      create: { ownerType: spec.ownerType, ownerId, currencyCode: spec.currencyCode },
      select: { id: true },
    });
    return account.id;
  }

  async post(transaction: LedgerTransaction): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const created = await tx.ledgerTransaction.create({
        data: { type: transaction.type, reference: transaction.reference },
        select: { id: true },
      });
      await tx.ledgerEntry.createMany({
        data: transaction.lines.map((line) => ({
          transactionId: created.id,
          accountId: line.accountId,
          direction: line.direction,
          amount: line.amount.amountMinor,
          currencyCode: line.amount.currencyCode,
        })),
      });
    });
  }

  async balanceMinor(accountId: string): Promise<number> {
    const [credited, debited] = await Promise.all([
      this.sumByDirection(accountId, 'CREDIT'),
      this.sumByDirection(accountId, 'DEBIT'),
    ]);
    return credited - debited;
  }

  private async resolvePlatformAccount(systemKey: string, currencyCode: string): Promise<string> {
    const account = await this.prisma.ledgerAccount.upsert({
      where: { systemKey },
      update: {},
      create: { ownerType: 'PLATFORM', systemKey, currencyCode },
      select: { id: true },
    });
    return account.id;
  }

  private async sumByDirection(accountId: string, direction: 'CREDIT' | 'DEBIT'): Promise<number> {
    const result = await this.prisma.ledgerEntry.aggregate({
      _sum: { amount: true },
      where: { accountId, direction },
    });
    return result._sum.amount ?? 0;
  }
}
