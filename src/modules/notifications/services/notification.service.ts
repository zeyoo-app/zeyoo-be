import { Injectable, NotFoundException } from '@nestjs/common';
import { Notification, NotificationPreference } from '@prisma/client';
import { PrismaService } from '@platform/database/prisma.service';
import { UpdatePreferencesDto } from '../dto/notification.dto';

export interface NewNotification {
  userId: string;
  type: string;
  title: string;
  body: string;
}

@Injectable()
export class NotificationService {
  constructor(private readonly prisma: PrismaService) {}

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
}
