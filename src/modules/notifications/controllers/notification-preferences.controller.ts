import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { NotificationPreference } from '@prisma/client';
import { CurrentUser, Principal } from '@platform/auth';
import { UpdatePreferencesDto } from '../dto/notification.dto';
import { NotificationService } from '../services/notification.service';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('me/notification-preferences')
export class NotificationPreferencesController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  get(@CurrentUser() principal: Principal): Promise<NotificationPreference> {
    return this.notifications.getPreferences(principal.userId);
  }

  @Patch()
  update(
    @CurrentUser() principal: Principal,
    @Body() dto: UpdatePreferencesDto,
  ): Promise<NotificationPreference> {
    return this.notifications.updatePreferences(principal.userId, dto);
  }
}
