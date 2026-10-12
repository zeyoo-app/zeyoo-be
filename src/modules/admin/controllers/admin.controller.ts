import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Campaign, CampaignStatus, Category, User, UserStatus, UserType } from '@prisma/client';
import { CurrentUser, Principal } from '@platform/auth';
import { Permission, RequirePermission } from '@platform/rbac';
import { CampaignService, CategoryService } from '@modules/campaigns/campaigns.public';
import { UserService } from '@modules/iam/iam.public';
import { RefundService } from '@modules/payments/payments.public';
import { CreateCategoryDto } from '../dto/admin.dto';
import {
  AdminAuditRow,
  AdminBilling,
  AdminCampaignRow,
  AdminFundingRow,
  AdminOrganizationRow,
  AdminOverview,
  AdminReadService,
  AdminUserRow,
  AdminWithdrawalRow,
  Page,
  PageQuery,
} from '../services/admin-read.service';

const USER_TYPES: UserType[] = ['BRAND_USER', 'CREATOR', 'ADMIN'];
const USER_STATUSES: UserStatus[] = ['PENDING', 'ACTIVE', 'SUSPENDED', 'DELETED'];
const CAMPAIGN_STATUSES: CampaignStatus[] = ['DRAFT', 'PUBLISHED', 'CLOSED'];

function oneOf<T extends string>(
  value: string | undefined,
  allowed: T[],
  label: string,
): T | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  if (!allowed.includes(value as T)) {
    throw new BadRequestException(`Unknown ${label}.`);
  }
  return value as T;
}

function pageOf(page?: string, pageSize?: string): PageQuery {
  const toNumber = (value?: string): number | undefined => {
    const parsed = Number(value);
    return value !== undefined && Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
  };
  return { page: toNumber(page), pageSize: toNumber(pageSize) };
}

@ApiTags('admin')
@ApiBearerAuth()
@RequirePermission(Permission.AdminAccess)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly read: AdminReadService,
    private readonly users: UserService,
    private readonly campaigns: CampaignService,
    private readonly categories: CategoryService,
    private readonly refunds: RefundService,
  ) {}

  @Get('overview')
  overview(): Promise<AdminOverview> {
    return this.read.overview();
  }

  @Get('users')
  listUsers(
    @Query('search') search?: string,
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<Page<AdminUserRow>> {
    return this.read.users({
      search,
      type: oneOf(type, USER_TYPES, 'user type'),
      status: oneOf(status, USER_STATUSES, 'status'),
      ...pageOf(page, pageSize),
    });
  }

  @HttpCode(HttpStatus.OK)
  @Post('users/:userId/suspend')
  async suspendUser(
    @CurrentUser() principal: Principal,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<User> {
    const user = await this.requireUser(userId);
    if (user.id === principal.userId || user.type === 'ADMIN') {
      throw new ForbiddenException('Staff accounts are managed under Staff.');
    }
    if (user.status !== 'ACTIVE') {
      throw new ConflictException('Only an active account can be suspended.');
    }
    return this.users.setStatus(userId, 'SUSPENDED');
  }

  @HttpCode(HttpStatus.OK)
  @Post('users/:userId/reactivate')
  async reactivateUser(@Param('userId', ParseUUIDPipe) userId: string): Promise<User> {
    const user = await this.requireUser(userId);
    if (user.status !== 'SUSPENDED') {
      throw new ConflictException('Only a suspended account can be reactivated.');
    }
    return this.users.setStatus(userId, 'ACTIVE');
  }

  @Get('organizations')
  listOrganizations(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<Page<AdminOrganizationRow>> {
    return this.read.organizations(pageOf(page, pageSize));
  }

  @Get('campaigns')
  listCampaigns(
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<Page<AdminCampaignRow>> {
    return this.read.campaigns({
      status: oneOf(status, CAMPAIGN_STATUSES, 'status'),
      search,
      ...pageOf(page, pageSize),
    });
  }

  @HttpCode(HttpStatus.OK)
  @Post('campaigns/:campaignId/close')
  closeCampaign(@Param('campaignId', ParseUUIDPipe) campaignId: string): Promise<Campaign> {
    return this.campaigns.closeAsAdmin(campaignId);
  }

  @HttpCode(HttpStatus.OK)
  @Post('campaigns/:campaignId/refund')
  refundCampaign(
    @CurrentUser() principal: Principal,
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
  ): Promise<{ refundedMinor: number; currencyCode: string; refunds: number }> {
    return this.refunds.refundUnspent(campaignId, principal.userId);
  }

  @Get('fundings')
  listFundings(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<Page<AdminFundingRow>> {
    return this.read.fundings(pageOf(page, pageSize));
  }

  @Get('withdrawals')
  listWithdrawals(
    @Query('scope') scope?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<Page<AdminWithdrawalRow>> {
    return this.read.withdrawals(scope === 'history' ? 'history' : 'open', pageOf(page, pageSize));
  }

  @Get('billing')
  billing(): Promise<AdminBilling> {
    return this.read.billing();
  }

  @Get('categories')
  listCategories(): Promise<Category[]> {
    return this.categories.list();
  }

  @Post('campaign-categories')
  createCategory(@Body() dto: CreateCategoryDto): Promise<Category> {
    return this.categories.create(dto.name);
  }

  @Get('audit-log')
  auditLog(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<Page<AdminAuditRow>> {
    return this.read.auditLog(pageOf(page, pageSize));
  }

  private async requireUser(userId: string): Promise<User> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found.');
    }
    return user;
  }
}
