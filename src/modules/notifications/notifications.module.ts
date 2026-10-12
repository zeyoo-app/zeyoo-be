import { Module } from '@nestjs/common';
import { NotificationPreferencesController } from './controllers/notification-preferences.controller';
import { NotificationsController } from './controllers/notifications.controller';
import { DevicesController } from './controllers/devices.controller';
import { ExpoPushSender, PushSender } from './push-sender';
import { NotificationService } from './services/notification.service';

@Module({
  controllers: [NotificationsController, NotificationPreferencesController, DevicesController],
  providers: [NotificationService, { provide: PushSender, useClass: ExpoPushSender }],
  exports: [NotificationService],
})
export class NotificationsModule {}
