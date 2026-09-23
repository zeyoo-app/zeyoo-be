import { Module } from '@nestjs/common';
import { NotificationPreferencesController } from './controllers/notification-preferences.controller';
import { NotificationsController } from './controllers/notifications.controller';
import { NotificationService } from './services/notification.service';

@Module({
  controllers: [NotificationsController, NotificationPreferencesController],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationsModule {}
