import { SetMetadata } from '@nestjs/common';

export const ALLOW_STAFF_KEY = 'allowStaff';

/**
 * Lets a back-office session call a route shared with users (such as a dispute
 * thread). Staff sessions otherwise reach only routes that require admin access.
 */
export const AllowStaff = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_STAFF_KEY, true);
