import { Body, Controller, Delete, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Principal } from '@platform/auth';
import { RegisterDeviceDto } from '../dto/device.dto';
import { NotificationService } from '../services/notification.service';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('me/devices')
export class DevicesController {
  constructor(private readonly notifications: NotificationService) {}

  @HttpCode(HttpStatus.NO_CONTENT)
  @Post()
  register(@CurrentUser() principal: Principal, @Body() dto: RegisterDeviceDto): Promise<void> {
    return this.notifications.registerDevice(principal.userId, dto.token, dto.platform);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete()
  unregister(@CurrentUser() principal: Principal, @Body() dto: RegisterDeviceDto): Promise<void> {
    return this.notifications.unregisterDevice(principal.userId, dto.token);
  }
}
