import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DirectoryQueryDto } from '../dto/directory-query.dto';
import {
  CreatorProfileService,
  CreatorProfileWithAccounts,
} from '../services/creator-profile.service';

@ApiTags('creators')
@ApiBearerAuth()
@Controller('creators')
export class CreatorsDirectoryController {
  constructor(private readonly profiles: CreatorProfileService) {}

  @Get()
  list(@Query() query: DirectoryQueryDto): Promise<CreatorProfileWithAccounts[]> {
    return this.profiles.listDirectory({
      platform: query.platform,
      verifiedOnly: query.verifiedOnly,
    });
  }

  @Get(':creatorUserId')
  get(
    @Param('creatorUserId', ParseUUIDPipe) creatorUserId: string,
  ): Promise<CreatorProfileWithAccounts> {
    return this.profiles.getPublicByUserId(creatorUserId);
  }
}
