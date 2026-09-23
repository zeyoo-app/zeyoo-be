import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Campaign, Category, Organization, User } from '@prisma/client';
import { Permission, RequirePermission } from '@platform/rbac';
import { CampaignService, CategoryService } from '@modules/campaigns/campaigns.public';
import { OrganizationService, UserService } from '@modules/iam/iam.public';
import { CreateCategoryDto } from '../dto/admin.dto';

@ApiTags('admin')
@ApiBearerAuth()
@RequirePermission(Permission.AdminAccess)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly users: UserService,
    private readonly organizations: OrganizationService,
    private readonly campaigns: CampaignService,
    private readonly categories: CategoryService,
  ) {}

  @Get('users')
  listUsers(): Promise<User[]> {
    return this.users.listAll();
  }

  @HttpCode(HttpStatus.OK)
  @Post('users/:userId/suspend')
  suspendUser(@Param('userId', ParseUUIDPipe) userId: string): Promise<User> {
    return this.users.setStatus(userId, 'SUSPENDED');
  }

  @HttpCode(HttpStatus.OK)
  @Post('users/:userId/reactivate')
  reactivateUser(@Param('userId', ParseUUIDPipe) userId: string): Promise<User> {
    return this.users.setStatus(userId, 'ACTIVE');
  }

  @Get('organizations')
  listOrganizations(): Promise<Organization[]> {
    return this.organizations.listAll();
  }

  @Get('campaigns')
  listCampaigns(): Promise<Campaign[]> {
    return this.campaigns.listAll();
  }

  @Post('campaign-categories')
  createCategory(@Body() dto: CreateCategoryDto): Promise<Category> {
    return this.categories.create(dto.name);
  }
}
