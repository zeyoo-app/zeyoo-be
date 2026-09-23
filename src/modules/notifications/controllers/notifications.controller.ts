import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Notification } from '@prisma/client';
import { CurrentUser, Principal } from '@platform/auth';
import { NotificationService } from '../services/notification.service';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('me/notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  list(@CurrentUser() principal: Principal): Promise<Notification[]> {
    return this.notifications.listForUser(principal.userId);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':notificationId/read')
  markRead(
    @CurrentUser() principal: Principal,
    @Param('notificationId', ParseUUIDPipe) notificationId: string,
  ): Promise<Notification> {
    return this.notifications.markRead(principal.userId, notificationId);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('read-all')
  markAllRead(@CurrentUser() principal: Principal): Promise<void> {
    return this.notifications.markAllRead(principal.userId);
  }
}
