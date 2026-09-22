import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Withdrawal } from '@prisma/client';
import { PrismaService } from '@platform/database/prisma.service';
import { Money } from '../domain/money';
import { PAYMENT_GATEWAY, PaymentGatewayPort } from '../domain/ports/payment-gateway.port';
import { LedgerService } from './ledger.service';

const OPEN_STATUSES = ['REQUESTED', 'HELD'] as const;

@Injectable()
export class WithdrawalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGatewayPort,
  ) {}

  async request(
    creatorUserId: string,
    amountMinor: number,
    currencyCode: string,
  ): Promise<Withdrawal> {
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
      throw new BadRequestException('Withdrawal amount must be a positive integer.');
    }
    const available = await this.availableMinor(creatorUserId, currencyCode);
    if (amountMinor > available) {
      throw new ConflictException('Amount exceeds available balance.');
    }
    return this.prisma.withdrawal.create({
      data: { creatorUserId, amount: amountMinor, currencyCode },
    });
  }

  listOwn(creatorUserId: string): Promise<Withdrawal[]> {
    return this.prisma.withdrawal.findMany({
      where: { creatorUserId },
      orderBy: { createdAt: 'desc' },
    });
  }

  listOpen(): Promise<Withdrawal[]> {
    return this.prisma.withdrawal.findMany({
      where: { status: { in: [...OPEN_STATUSES] } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async hold(withdrawalId: string, reason: string): Promise<Withdrawal> {
    const withdrawal = await this.loadOrThrow(withdrawalId);
    this.assertStatus(withdrawal, 'REQUESTED', 'Only a requested withdrawal can be held.');
    return this.prisma.withdrawal.update({
      where: { id: withdrawal.id },
      data: { status: 'HELD', holdReason: reason },
    });
  }

  async release(withdrawalId: string): Promise<Withdrawal> {
    const withdrawal = await this.loadOrThrow(withdrawalId);
    this.assertStatus(withdrawal, 'HELD', 'Only a held withdrawal can be released.');
    return this.prisma.withdrawal.update({
      where: { id: withdrawal.id },
      data: { status: 'REQUESTED', holdReason: null },
    });
  }

  async reject(withdrawalId: string, adminId: string): Promise<Withdrawal> {
    const withdrawal = await this.loadOrThrow(withdrawalId);
    if (!this.isOpen(withdrawal)) {
      throw new ConflictException('Only an open withdrawal can be rejected.');
    }
    return this.prisma.withdrawal.update({
      where: { id: withdrawal.id },
      data: { status: 'REJECTED', decidedByUserId: adminId, decidedAt: new Date() },
    });
  }

  async approve(withdrawalId: string, adminId: string): Promise<Withdrawal> {
    const withdrawal = await this.loadOrThrow(withdrawalId);
    this.assertStatus(withdrawal, 'REQUESTED', 'Only a requested withdrawal can be approved.');
    if (!withdrawal.destinationAccountId) {
      throw new ConflictException('The creator has not configured a payout account.');
    }

    const payout = await this.gateway.createPayout({
      amountMinor: withdrawal.amount,
      currencyCode: withdrawal.currencyCode,
      destinationAccountId: withdrawal.destinationAccountId,
      metadata: { withdrawalId: withdrawal.id },
    });
    await this.ledger.recordWithdrawal(
      withdrawal.creatorUserId,
      Money.of(withdrawal.amount, withdrawal.currencyCode),
      withdrawal.id,
    );
    return this.prisma.withdrawal.update({
      where: { id: withdrawal.id },
      data: {
        status: 'PAID',
        stripePayoutId: payout.payoutId,
        decidedByUserId: adminId,
        decidedAt: new Date(),
      },
    });
  }

  private async availableMinor(creatorUserId: string, currencyCode: string): Promise<number> {
    const balance = await this.ledger.creatorBalanceMinor(creatorUserId, currencyCode);
    const open = await this.prisma.withdrawal.aggregate({
      _sum: { amount: true },
      where: { creatorUserId, currencyCode, status: { in: [...OPEN_STATUSES] } },
    });
    return balance - (open._sum.amount ?? 0);
  }

  private isOpen(withdrawal: Withdrawal): boolean {
    return (OPEN_STATUSES as readonly string[]).includes(withdrawal.status);
  }

  private assertStatus(
    withdrawal: Withdrawal,
    expected: Withdrawal['status'],
    message: string,
  ): void {
    if (withdrawal.status !== expected) {
      throw new ConflictException(message);
    }
  }

  private async loadOrThrow(withdrawalId: string): Promise<Withdrawal> {
    const withdrawal = await this.prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
    if (!withdrawal) {
      throw new NotFoundException('Withdrawal not found.');
    }
    return withdrawal;
  }
}
