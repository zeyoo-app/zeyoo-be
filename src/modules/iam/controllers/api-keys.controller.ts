import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Principal } from '@platform/auth';
import { Permission, RequirePermission } from '@platform/rbac';
import { CreateApiKeyDto } from '../dto/api-key.dto';
import { ApiKeyService, CreatedApiKey, PublicApiKey } from '../services/api-key.service';

@ApiTags('api-keys')
@ApiBearerAuth()
@RequirePermission(Permission.ApiKeyManage)
@Controller('organizations/:organizationId/api-keys')
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeyService) {}

  @Post()
  create(
    @CurrentUser() principal: Principal,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: CreateApiKeyDto,
  ): Promise<CreatedApiKey> {
    return this.apiKeys.create(organizationId, principal.userId, dto.name, dto.scopes);
  }

  @Get()
  list(
    @CurrentUser() principal: Principal,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
  ): Promise<PublicApiKey[]> {
    return this.apiKeys.list(organizationId, principal.userId);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':apiKeyId')
  revoke(
    @CurrentUser() principal: Principal,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('apiKeyId', ParseUUIDPipe) apiKeyId: string,
  ): Promise<void> {
    return this.apiKeys.revoke(organizationId, principal.userId, apiKeyId);
  }
}
