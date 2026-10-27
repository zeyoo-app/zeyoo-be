import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Dispute, DisputeEvent, DisputeStatus, DisputeSubjectType } from '@prisma/client';
import { PrismaService } from '@platform/database/prisma.service';
import { Mailer } from '@platform/mail';
import { CampaignService } from '@modules/campaigns/campaigns.public';
import { CreatorProfileService } from '@modules/creators/creators.public';
import { FraudService } from '@modules/fraud/fraud.public';
import { OrganizationService, StaffService, UserService } from '@modules/iam/iam.public';
import { NotificationService } from '@modules/notifications/notifications.public';
import { WithdrawalService } from '@modules/payments/payments.public';
import { ReviewService, SubmissionService } from '@modules/submissions/submissions.public';
import { responseDueFor } from '../domain/response-deadline';
import { DisputeDecisionDto, DisputeMessageDto, OpenDisputeDto } from '../dto/dispute.dto';

const ACTIVE_STATUSES: DisputeStatus[] = ['OPEN', 'UNDER_REVIEW'];

export type EventAuthor = 'YOU' | 'SUPPORT' | 'OTHER';

export interface DisputeEventView {
  id: string;
  message: string;
  createdAt: Date;
  author: EventAuthor;
}

export interface DisputeView {
  id: string;
  subjectType: DisputeSubjectType;
  subjectId: string | null;
  subjectTitle: string;
  reason: string;
  status: DisputeStatus;
  createdAt: Date;
  updatedAt: Date;
  openedByUserId: string;
  openedByName: string;
  /** When support has promised a first reply by. */
  responseDueAt: Date;
  respondedAt: Date | null;
  escalatedAt: Date | null;
  /** Active, unanswered and past the deadline. */
  overdue: boolean;
  /** The opener may escalate: it is overdue and not yet escalated. */
  canEscalate: boolean;
  events: DisputeEventView[];
}

@Injectable()
export class DisputeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly submissions: SubmissionService,
    private readonly reviews: ReviewService,
    private readonly campaigns: CampaignService,
    private readonly organizations: OrganizationService,
    private readonly withdrawals: WithdrawalService,
    private readonly fraud: FraudService,
    private readonly users: UserService,
    private readonly profiles: CreatorProfileService,
    private readonly notifications: NotificationService,
    private readonly staff: StaffService,
    private readonly mailer: Mailer,
  ) {}

  async open(userId: string, dto: OpenDisputeDto): Promise<DisputeView> {
    await this.assertPartyToSubject(userId, dto.subjectType, dto.subjectId);
    await this.assertNoActiveDispute(userId, dto.subjectType, dto.subjectId);
    const dispute = await this.prisma.dispute.create({
      data: {
        openedByUserId: userId,
        subjectType: dto.subjectType,
        subjectId: dto.subjectId ?? null,
        reason: dto.reason,
        responseDueAt: responseDueFor(new Date()),
        events: { create: { authorUserId: userId, message: dto.reason } },
      },
      include: { events: { orderBy: { createdAt: 'asc' } } },
    });
    await this.notifyAdmins(dispute.id);
    return this.toView(dispute, userId);
  }

  async listOwn(userId: string): Promise<DisputeView[]> {
    const disputes = await this.prisma.dispute.findMany({
      where: { openedByUserId: userId },
      include: { events: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(disputes.map((dispute) => this.toView(dispute, userId)));
  }

  async listForAdmin(scope: 'active' | 'closed', adminId: string): Promise<DisputeView[]> {
    const disputes = await this.prisma.dispute.findMany({
      where:
        scope === 'active'
          ? { status: { in: ACTIVE_STATUSES } }
          : { status: { notIn: ACTIVE_STATUSES } },
      include: { events: { orderBy: { createdAt: 'asc' } } },
      orderBy:
        scope === 'active'
          ? [{ escalatedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'asc' }]
          : { createdAt: 'desc' },
    });
    return Promise.all(disputes.map((dispute) => this.toView(dispute, adminId)));
  }

  async get(disputeId: string, requesterId: string, isAdmin: boolean): Promise<DisputeView> {
    const dispute = await this.requireDispute(disputeId);
    this.assertCanAccess(dispute, requesterId, isAdmin);
    return this.toView(dispute, requesterId);
  }

  async addMessage(
    disputeId: string,
    requesterId: string,
    isAdmin: boolean,
    dto: DisputeMessageDto,
  ): Promise<DisputeView> {
    const dispute = await this.requireDispute(disputeId);
    this.assertCanAccess(dispute, requesterId, isAdmin);
    this.assertActive(dispute);
    await this.prisma.disputeEvent.create({
      data: { disputeId, authorUserId: requesterId, message: dto.message },
    });
    if (isAdmin) {
      await this.markResponded(dispute);
      await this.notifyOpener(dispute, 'Support replied to your dispute', dto.message);
    }
    return this.get(disputeId, requesterId, isAdmin);
  }

  async markUnderReview(disputeId: string, adminId: string): Promise<DisputeView> {
    const dispute = await this.requireDispute(disputeId);
    if (dispute.status !== 'OPEN') {
      throw new ConflictException('Only a new dispute can be taken into review.');
    }
    await this.prisma.dispute.update({
      where: { id: disputeId },
      data: { status: 'UNDER_REVIEW', respondedAt: dispute.respondedAt ?? new Date() },
    });
    await this.notifyOpener(
      dispute,
      'Your dispute is being reviewed',
      'Support has picked up your case.',
    );
    return this.get(disputeId, adminId, true);
  }

  async decide(disputeId: string, adminId: string, dto: DisputeDecisionDto): Promise<DisputeView> {
    const dispute = await this.requireDispute(disputeId);
    this.assertActive(dispute);
    if (dto.outcome === 'UPHELD') {
      await this.applyUpheld(dispute, adminId, dto.note);
    } else {
      await this.applyDenied(dispute, adminId);
    }
    await this.prisma.$transaction([
      this.prisma.disputeEvent.create({
        data: { disputeId, authorUserId: adminId, message: dto.note },
      }),
      this.prisma.dispute.update({
        where: { id: disputeId },
        data: {
          status: dto.outcome === 'UPHELD' ? 'RESOLVED' : 'REJECTED',
          respondedAt: dispute.respondedAt ?? new Date(),
        },
      }),
    ]);
    await this.notifyOpener(
      dispute,
      dto.outcome === 'UPHELD' ? 'Your dispute was upheld' : 'Your dispute was not upheld',
      dto.note,
    );
    return this.get(disputeId, adminId, true);
  }

  private async applyUpheld(dispute: Dispute, adminId: string, note: string): Promise<void> {
    if (dispute.subjectType === 'SUBMISSION' && dispute.subjectId) {
      const submission = await this.submissions.withLatestLink(dispute.subjectId);
      if (submission.creatorUserId === dispute.openedByUserId) {
        await this.reviews.overrideAsAdmin(dispute.subjectId, adminId, 'APPROVED', note);
      }
    }
    if (dispute.subjectType === 'FRAUD_CASE' && dispute.subjectId) {
      await this.closeFraudCaseIfOpen(dispute.subjectId, adminId, 'DISMISSED');
    }
  }

  private async applyDenied(dispute: Dispute, adminId: string): Promise<void> {
    if (dispute.subjectType === 'FRAUD_CASE' && dispute.subjectId) {
      await this.closeFraudCaseIfOpen(dispute.subjectId, adminId, 'RESOLVED');
    }
  }

  private async closeFraudCaseIfOpen(
    caseId: string,
    adminId: string,
    status: 'RESOLVED' | 'DISMISSED',
  ): Promise<void> {
    try {
      await this.fraud.closeAsAdmin(caseId, adminId, status);
    } catch (error) {
      if (!(error instanceof ConflictException)) {
        throw error;
      }
    }
  }

  private async assertPartyToSubject(
    userId: string,
    subjectType: DisputeSubjectType,
    subjectId: string | undefined,
  ): Promise<void> {
    if (!subjectId || subjectType === 'OTHER') {
      return;
    }
    if (subjectType === 'SUBMISSION') {
      await this.submissions.getById(subjectId, userId);
    } else if (subjectType === 'WITHDRAWAL') {
      await this.withdrawals.assertOwnedBy(subjectId, userId);
    } else if (subjectType === 'FRAUD_CASE') {
      await this.fraud.assertCreatorOf(subjectId, userId);
    } else {
      const campaign = await this.campaigns.requireCampaign(subjectId);
      await this.organizations.assertMember(campaign.organizationId, userId);
    }
  }

  private async assertNoActiveDispute(
    userId: string,
    subjectType: DisputeSubjectType,
    subjectId: string | undefined,
  ): Promise<void> {
    if (!subjectId) {
      return;
    }
    const existing = await this.prisma.dispute.findFirst({
      where: { openedByUserId: userId, subjectType, subjectId, status: { in: ACTIVE_STATUSES } },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('You already have an open dispute about this.');
    }
  }

  private async toView(
    dispute: Dispute & { events: DisputeEvent[] },
    viewerId: string,
  ): Promise<DisputeView> {
    const authorIds = [...new Set(dispute.events.map((event) => event.authorUserId))];
    // Staff replies come from staff accounts; older ones came from ADMIN-type users.
    const adminIds = new Set((await this.staff.emailsByIds(authorIds)).keys());
    for (const authorId of authorIds) {
      if (!adminIds.has(authorId) && (await this.users.findById(authorId))?.type === 'ADMIN') {
        adminIds.add(authorId);
      }
    }
    const authorOf = (authorId: string): EventAuthor =>
      authorId === viewerId ? 'YOU' : adminIds.has(authorId) ? 'SUPPORT' : 'OTHER';
    const [subjectTitle, openedByName] = await Promise.all([
      this.subjectTitle(dispute),
      this.displayName(dispute.openedByUserId),
    ]);
    return {
      id: dispute.id,
      subjectType: dispute.subjectType,
      subjectId: dispute.subjectId,
      subjectTitle,
      reason: dispute.reason,
      status: dispute.status,
      createdAt: dispute.createdAt,
      updatedAt: dispute.updatedAt,
      openedByUserId: dispute.openedByUserId,
      openedByName,
      ...this.responseState(dispute, viewerId),
      events: dispute.events.map((event) => ({
        id: event.id,
        message: event.message,
        createdAt: event.createdAt,
        author: authorOf(event.authorUserId),
      })),
    };
  }

  private async subjectTitle(dispute: Dispute): Promise<string> {
    const { subjectType, subjectId } = dispute;
    if (!subjectId) {
      return 'General question';
    }
    try {
      if (subjectType === 'WITHDRAWAL') {
        return 'Withdrawal';
      }
      if (subjectType === 'SUBMISSION') {
        const submission = await this.submissions.withLatestLink(subjectId);
        return (await this.campaigns.requireCampaign(submission.campaignId)).title;
      }
      if (subjectType === 'CAMPAIGN') {
        return (await this.campaigns.requireCampaign(subjectId)).title;
      }
      const fraudCase = await this.fraud.findView(subjectId);
      return fraudCase ? `Earnings review: ${fraudCase.campaignTitle}` : 'Earnings review';
    } catch {
      return 'Removed item';
    }
  }

  private async displayName(userId: string): Promise<string> {
    const profile = (await this.profiles.summariesByUserIds([userId])).get(userId);
    if (profile) {
      return profile.displayName;
    }
    const user = await this.users.findById(userId);
    return user?.email ?? user?.phone ?? 'Brand user';
  }

  private responseState(
    dispute: Dispute,
    viewerId: string,
  ): Pick<
    DisputeView,
    'responseDueAt' | 'respondedAt' | 'escalatedAt' | 'overdue' | 'canEscalate'
  > {
    // Disputes opened before deadlines existed get the same two business days from opening.
    const responseDueAt = dispute.responseDueAt ?? responseDueFor(dispute.createdAt);
    const overdue =
      ACTIVE_STATUSES.includes(dispute.status) &&
      dispute.respondedAt === null &&
      responseDueAt.getTime() < Date.now();
    return {
      responseDueAt,
      respondedAt: dispute.respondedAt,
      escalatedAt: dispute.escalatedAt,
      overdue,
      canEscalate: overdue && dispute.escalatedAt === null && dispute.openedByUserId === viewerId,
    };
  }

  /** The person who opened it asks for senior attention once support has missed the deadline. */
  async escalate(disputeId: string, userId: string): Promise<DisputeView> {
    const dispute = await this.requireDispute(disputeId);
    if (dispute.openedByUserId !== userId) {
      throw new ForbiddenException('Only the person who opened a dispute can escalate it.');
    }
    this.assertActive(dispute);
    if (dispute.escalatedAt) {
      throw new ConflictException('This dispute has already been escalated.');
    }
    if (!this.responseState(dispute, userId).overdue) {
      throw new ConflictException('Support is still within its response time for this dispute.');
    }
    await this.applyEscalation(
      dispute,
      'Escalated: support has not replied within the response time.',
    );
    return this.get(disputeId, userId, false);
  }

  /** Escalates every unanswered dispute past its deadline; the hourly job calls this. */
  async escalateOverdue(): Promise<number> {
    const candidates = await this.prisma.dispute.findMany({
      where: {
        status: { in: ACTIVE_STATUSES },
        respondedAt: null,
        escalatedAt: null,
      },
      include: { events: { orderBy: { createdAt: 'asc' } } },
    });
    const overdue = candidates.filter(
      (dispute) =>
        (dispute.responseDueAt ?? responseDueFor(dispute.createdAt)).getTime() < Date.now(),
    );
    for (const dispute of overdue) {
      await this.applyEscalation(
        dispute,
        'Escalated automatically: no reply within the response time.',
      );
    }
    return overdue.length;
  }

  private async applyEscalation(dispute: Dispute, message: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.dispute.update({
        where: { id: dispute.id },
        data: { escalatedAt: new Date() },
      }),
      this.prisma.disputeEvent.create({
        data: { disputeId: dispute.id, authorUserId: dispute.openedByUserId, message },
      }),
    ]);
    await this.notifyOpener(
      dispute,
      'Your dispute was escalated',
      'It is now flagged as overdue for senior support to pick up first.',
    );
    await this.emailStaff(
      'Overdue dispute escalated',
      `Dispute ${dispute.id.slice(0, 8)} passed its response time and needs attention.`,
    );
  }

  private async markResponded(dispute: Dispute): Promise<void> {
    if (dispute.respondedAt === null) {
      await this.prisma.dispute.update({
        where: { id: dispute.id },
        data: { respondedAt: new Date() },
      });
    }
  }

  private notifyAdmins(disputeId: string): Promise<void> {
    return this.emailStaff(
      'New dispute to review',
      `Dispute ${disputeId.slice(0, 8)} is waiting in the admin queue.`,
    );
  }

  /** Staff are not app users, so back-office alerts go by email. A failed send never blocks the dispute. */
  private async emailStaff(subject: string, body: string): Promise<void> {
    const emails = await this.staff.activeEmails();
    await Promise.allSettled(
      emails.map((email) => this.mailer.sendNotification(email, subject, body)),
    );
  }

  private notifyOpener(dispute: Dispute, title: string, body: string): Promise<void> {
    return this.notifications.notify({
      userId: dispute.openedByUserId,
      type: 'DISPUTE_UPDATED',
      title,
      body,
    });
  }

  private assertCanAccess(dispute: Dispute, requesterId: string, isAdmin: boolean): void {
    if (!isAdmin && dispute.openedByUserId !== requesterId) {
      throw new ForbiddenException('You do not have access to this dispute.');
    }
  }

  private assertActive(dispute: Dispute): void {
    if (!ACTIVE_STATUSES.includes(dispute.status)) {
      throw new ConflictException('This dispute is closed.');
    }
  }

  private async requireDispute(disputeId: string): Promise<Dispute & { events: DisputeEvent[] }> {
    const dispute = await this.prisma.dispute.findUnique({
      where: { id: disputeId },
      include: { events: { orderBy: { createdAt: 'asc' } } },
    });
    if (!dispute) {
      throw new NotFoundException('Dispute not found.');
    }
    return dispute;
  }
}
