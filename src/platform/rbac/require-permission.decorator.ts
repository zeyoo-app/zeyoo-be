import { SetMetadata } from '@nestjs/common';
import { Permission } from './permission';

export const REQUIRED_PERMISSIONS_KEY = 'requiredPermissions';

/** Requires the caller to hold every listed permission. */
export const RequirePermission = (...permissions: Permission[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);
