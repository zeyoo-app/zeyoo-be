import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Withdrawal } from '@prisma/client';
import { PrismaService } from '@platform/database/prisma.service';
import { Money } from '../domain/money';
import { PAYMENT_GATEWAY, PaymentGatewayPort } from '../domain/ports/payment-gateway.port';
import { NotificationService } from '@modules/notifications/notifications.public';
import { LedgerService } from './ledger.service';

const OPEN_STATUSES = ['REQUESTED', 'HELD'] as const;

@Injectable()
export class WithdrawalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationService,
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
    const payoutAccount = await this.prisma.payoutAccount.findUnique({ where: { creatorUserId } });
    return this.prisma.withdrawal.create({
      data: {
        creatorUserId,
        amount: amountMinor,
        currencyCode,
        destinationAccountId: payoutAccount?.stripeAccountId ?? null,
      },
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

  private tell(withdrawal: Withdrawal, type: string, title: string, body: string): Promise<void> {
    return this.notifications.notify({ userId: withdrawal.creatorUserId, type, title, body });
  }

  /** Throws unless the withdrawal exists and belongs to this creator. */
  async assertOwnedBy(withdrawalId: string, creatorUserId: string): Promise<void> {
    const withdrawal = await this.loadOrThrow(withdrawalId);
    if (withdrawal.creatorUserId !== creatorUserId) {
      throw new ForbiddenException('This withdrawal is not yours.');
    }
  }

  async hold(withdrawalId: string, reason: string): Promise<Withdrawal> {
    const withdrawal = await this.loadOrThrow(withdrawalId);
    this.assertStatus(withdrawal, 'REQUESTED', 'Only a requested withdrawal can be held.');
    const held = await this.prisma.withdrawal.update({
      where: { id: withdrawal.id },
      data: { status: 'HELD', holdReason: reason },
    });
    await this.tell(held, 'WITHDRAWAL_HELD', 'Your withdrawal is on hold', `Reason: ${reason}`);
    return held;
  }

  async release(withdrawalId: string): Promise<Withdrawal> {
    const withdrawal = await this.loadOrThrow(withdrawalId);
    this.assertStatus(withdrawal, 'HELD', 'Only a held withdrawal can be released.');
    const released = await this.prisma.withdrawal.update({
      where: { id: withdrawal.id },
      data: { status: 'REQUESTED', holdReason: null },
    });
    await this.tell(
      released,
      'WITHDRAWAL_RELEASED',
      'Your withdrawal is back in the queue',
      'The hold was lifted and it will be reviewed again.',
    );
    return released;
  }

  async reject(withdrawalId: string, adminId: string): Promise<Withdrawal> {
    const withdrawal = await this.loadOrThrow(withdrawalId);
    if (!this.isOpen(withdrawal)) {
      throw new ConflictException('Only an open withdrawal can be rejected.');
    }
    const rejected = await this.prisma.withdrawal.update({
      where: { id: withdrawal.id },
      data: { status: 'REJECTED', decidedByUserId: adminId, decidedAt: new Date() },
    });
    await this.tell(
      rejected,
      'WITHDRAWAL_REJECTED',
      'Your withdrawal was not approved',
      'The amount is back in your available balance.',
    );
    return rejected;
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
    const paid = await this.prisma.withdrawal.update({
      where: { id: withdrawal.id },
      data: {
        status: 'PAID',
        stripePayoutId: payout.payoutId,
        decidedByUserId: adminId,
        decidedAt: new Date(),
      },
    });
    await this.tell(
      paid,
      'WITHDRAWAL_PAID',
      'Your withdrawal was sent',
      'The money is on its way to your payout account.',
    );
    return paid;
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
