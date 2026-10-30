import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Notification, NotificationPreference } from '@prisma/client';
import { Env } from '@platform/config/env.schema';
import { PrismaService } from '@platform/database/prisma.service';
import { appUrl } from '@platform/links';
import { Mailer } from '@platform/mail';
import { UpdatePreferencesDto } from '../dto/notification.dto';
import { PushSender } from '../push-sender';

/** Which preference switch governs each notification type; unknown types are always sent. */
const CATEGORY_BY_TYPE: Record<string, keyof CategoryPreferences> = {
  SUBMISSION_REVIEWED: 'submissionUpdates',
  EARNING_CREDITED: 'payoutUpdates',
  CAMPAIGN_INVITE: 'campaignInvites',
  WITHDRAWAL_HELD: 'payoutUpdates',
  WITHDRAWAL_RELEASED: 'payoutUpdates',
  WITHDRAWAL_REJECTED: 'payoutUpdates',
  WITHDRAWAL_PAID: 'payoutUpdates',
  APPLICATION_RECEIVED: 'submissionUpdates',
  SUBMISSION_RECEIVED: 'submissionUpdates',
  APPLICATION_REVIEWED: 'submissionUpdates',
  VERIFICATION_REVIEWED: 'submissionUpdates',
};

type CategoryPreferences = Pick<
  NotificationPreference,
  'submissionUpdates' | 'payoutUpdates' | 'campaignInvites' | 'productNews'
>;

function isCategoryEnabled(type: string, preferences: CategoryPreferences | null): boolean {
  const category = CATEGORY_BY_TYPE[type];
  return !preferences || !category || preferences[category];
}

/** The email button for each notification type; anything else gets the generic label. */
const ACTION_LABEL_BY_TYPE: Record<string, string> = {
  CAMPAIGN_INVITE: 'View invitation',
  APPLICATION_RECEIVED: 'Review application',
  APPLICATION_REVIEWED: 'Open campaign',
  SUBMISSION_RECEIVED: 'Review submission',
  SUBMISSION_REVIEWED: 'View submission',
  EARNING_CREDITED: 'View wallet',
  WITHDRAWAL_HELD: 'View wallet',
  WITHDRAWAL_RELEASED: 'View wallet',
  WITHDRAWAL_REJECTED: 'View wallet',
  WITHDRAWAL_PAID: 'View wallet',
  CAMPAIGN_REFUNDED: 'View campaign',
  FRAUD_FLAGGED: 'View campaign',
  FRAUD_CLEARED: 'View campaign',
  FRAUD_CONFIRMED: 'View campaign',
  DISPUTE_UPDATED: 'View dispute',
  VERIFICATION_REVIEWED: 'View profile',
};
const DEFAULT_ACTION_LABEL = 'Open Zeyoo';

export interface NewNotification {
  userId: string;
  type: string;
  title: string;
  body: string;
  /** Path of the page it is about (see AppPaths); opened on tap in every channel. */
  link?: string;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushSender,
    private readonly mailer: Mailer,
    private readonly config: ConfigService<Env, true>,
  ) {}

  // For notifying as a side effect of something that has already succeeded: a
  // failed notification is logged, never allowed to undo or fail that action. Besides
  // the in-app entry it pushes to the user's devices unless they turned push off, and
  // emails them unless they turned email off.
  async notify(notification: NewNotification): Promise<void> {
    try {
      const preferences = await this.prisma.notificationPreference.findUnique({
        where: { userId: notification.userId },
      });
      if (!isCategoryEnabled(notification.type, preferences)) {
        return;
      }
      await this.create(notification);
      if (preferences?.pushEnabled !== false) {
        await this.pushToDevices(notification);
      }
      if (preferences?.emailEnabled !== false) {
        await this.emailUser(notification);
      }
    } catch (error) {
      this.logger.warn(`Could not notify user ${notification.userId}: ${String(error)}`);
    }
  }

  // Exposed so other modules can raise a notification for a user.
  create(notification: NewNotification): Promise<Notification> {
    return this.prisma.notification.create({ data: notification });
  }

  listForUser(userId: string): Promise<Notification[]> {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async markRead(userId: string, notificationId: string): Promise<Notification> {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });
    if (!notification || notification.userId !== userId) {
      throw new NotFoundException('Notification not found.');
    }
    return this.prisma.notification.update({
      where: { id: notification.id },
      data: { readAt: notification.readAt ?? new Date() },
    });
  }

  async markAllRead(userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  }

  async registerDevice(userId: string, token: string, platform: string): Promise<void> {
    await this.prisma.deviceToken.upsert({
      where: { token },
      // A token belongs to whoever signed in on the device last.
      update: { userId, platform },
      create: { userId, token, platform },
    });
  }

  async unregisterDevice(userId: string, token: string): Promise<void> {
    await this.prisma.deviceToken.deleteMany({ where: { userId, token } });
  }

  async deleteAllFor(userId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.notification.deleteMany({ where: { userId } }),
      this.prisma.notificationPreference.deleteMany({ where: { userId } }),
      this.prisma.deviceToken.deleteMany({ where: { userId } }),
    ]);
  }

  getPreferences(userId: string): Promise<NotificationPreference> {
    return this.prisma.notificationPreference.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });
  }

  updatePreferences(userId: string, dto: UpdatePreferencesDto): Promise<NotificationPreference> {
    return this.prisma.notificationPreference.upsert({
      where: { userId },
      update: dto,
      create: { userId, ...dto },
    });
  }

  // Email is its own try so a mail outage never costs the push or the in-app entry.
  private async emailUser(notification: NewNotification): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: notification.userId },
        select: { email: true },
      });
      if (user?.email) {
        const link = notification.link ?? '/notifications';
        await this.mailer.sendNotification(user.email, notification.title, notification.body, {
          label: ACTION_LABEL_BY_TYPE[notification.type] ?? DEFAULT_ACTION_LABEL,
          url: appUrl(this.config.get('APP_WEB_URL', { infer: true }), link),
        });
      }
    } catch (error) {
      this.logger.warn(`Could not email user ${notification.userId}: ${String(error)}`);
    }
  }

  private async pushToDevices(notification: NewNotification): Promise<void> {
    const devices = await this.prisma.deviceToken.findMany({
      where: { userId: notification.userId },
      select: { token: true },
    });
    if (devices.length === 0) {
      return;
    }
    const invalid = await this.push.send(
      devices.map((device) => device.token),
      {
        title: notification.title,
        body: notification.body,
        data: { type: notification.type, ...(notification.link ? { link: notification.link } : {}) },
      },
    );
    if (invalid.length > 0) {
      await this.prisma.deviceToken.deleteMany({ where: { token: { in: invalid } } });
    }
  }
}
