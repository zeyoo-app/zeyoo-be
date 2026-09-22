import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Organization } from '@prisma/client';
import { CurrentUser, Principal } from '@platform/auth';
import { Permission, RequirePermission } from '@platform/rbac';
import { CreateOrganizationDto } from '../dto/organization.dto';
import { OrganizationService } from '../services/organization.service';

@ApiTags('organizations')
@ApiBearerAuth()
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationService) {}

  @RequirePermission(Permission.OrgManage)
  @Post()
  create(
    @CurrentUser() principal: Principal,
    @Body() dto: CreateOrganizationDto,
  ): Promise<Organization> {
    return this.organizations.create(principal.userId, dto.name);
  }

  @Get()
  list(@CurrentUser() principal: Principal): Promise<Organization[]> {
    return this.organizations.listForUser(principal.userId);
  }

  @Get(':organizationId')
  get(
    @CurrentUser() principal: Principal,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
  ): Promise<Organization> {
    return this.organizations.getForMember(organizationId, principal.userId);
  }
}
