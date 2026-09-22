import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Principal } from '@platform/auth';
import { AccountProfile, ProfileService } from '../services/profile.service';

@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(private readonly profiles: ProfileService) {}

  @Get()
  getProfile(@CurrentUser() principal: Principal): Promise<AccountProfile> {
    return this.profiles.getProfile(principal.userId);
  }
}
