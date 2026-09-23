import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Dispute, DisputeEvent, DisputeStatus } from '@prisma/client';
import { PrismaService } from '@platform/database/prisma.service';
import { DisputeMessageDto, OpenDisputeDto } from '../dto/dispute.dto';

export type DisputeWithEvents = Dispute & { events: DisputeEvent[] };

@Injectable()
export class DisputeService {
  constructor(private readonly prisma: PrismaService) {}

  open(userId: string, dto: OpenDisputeDto): Promise<Dispute> {
    return this.prisma.dispute.create({
      data: {
        openedByUserId: userId,
        subjectType: dto.subjectType,
        subjectId: dto.subjectId ?? null,
        reason: dto.reason,
        events: { create: { authorUserId: userId, message: dto.reason } },
      },
    });
  }

  listOwn(userId: string): Promise<Dispute[]> {
    return this.prisma.dispute.findMany({
      where: { openedByUserId: userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  listOpen(): Promise<Dispute[]> {
    return this.prisma.dispute.findMany({
      where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async get(disputeId: string, requesterId: string, isAdmin: boolean): Promise<DisputeWithEvents> {
    const dispute = await this.prisma.dispute.findUnique({
      where: { id: disputeId },
      include: { events: { orderBy: { createdAt: 'asc' } } },
    });
    if (!dispute) {
      throw new NotFoundException('Dispute not found.');
    }
    this.assertCanAccess(dispute, requesterId, isAdmin);
    return dispute;
  }

  async addMessage(
    disputeId: string,
    requesterId: string,
    isAdmin: boolean,
    dto: DisputeMessageDto,
  ): Promise<DisputeEvent> {
    const dispute = await this.requireDispute(disputeId);
    this.assertCanAccess(dispute, requesterId, isAdmin);
    if (dispute.status === 'RESOLVED' || dispute.status === 'REJECTED') {
      throw new ConflictException('This dispute is closed.');
    }
    return this.prisma.disputeEvent.create({
      data: { disputeId, authorUserId: requesterId, message: dto.message },
    });
  }

  review(disputeId: string): Promise<Dispute> {
    return this.transition(disputeId, 'UNDER_REVIEW', ['OPEN']);
  }

  resolve(disputeId: string): Promise<Dispute> {
    return this.transition(disputeId, 'RESOLVED', ['OPEN', 'UNDER_REVIEW']);
  }

  reject(disputeId: string): Promise<Dispute> {
    return this.transition(disputeId, 'REJECTED', ['OPEN', 'UNDER_REVIEW']);
  }

  private async transition(
    disputeId: string,
    status: DisputeStatus,
    allowedFrom: DisputeStatus[],
  ): Promise<Dispute> {
    const dispute = await this.requireDispute(disputeId);
    if (!allowedFrom.includes(dispute.status)) {
      throw new ConflictException(`A dispute cannot move to ${status} from ${dispute.status}.`);
    }
    return this.prisma.dispute.update({ where: { id: dispute.id }, data: { status } });
  }

  private assertCanAccess(dispute: Dispute, requesterId: string, isAdmin: boolean): void {
    if (!isAdmin && dispute.openedByUserId !== requesterId) {
      throw new ForbiddenException('You do not have access to this dispute.');
    }
  }

  private async requireDispute(disputeId: string): Promise<Dispute> {
    const dispute = await this.prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!dispute) {
      throw new NotFoundException('Dispute not found.');
    }
    return dispute;
  }
}
