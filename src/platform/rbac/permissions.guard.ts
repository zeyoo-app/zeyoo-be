import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { Principal } from '../auth/principal';
import { ALLOW_STAFF_KEY } from './allow-staff.decorator';
import { Permission } from './permission';
import { REQUIRED_PERMISSIONS_KEY } from './require-permission.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    const required = this.reflector.getAllAndOverride<Permission[]>(
      REQUIRED_PERMISSIONS_KEY,
      targets,
    );
    const { user } = context.switchToHttp().getRequest<Request & { user?: Principal }>();

    // A staff session is not a user, so it is kept to the back office: routes that
    // require admin access, plus the few shared routes that opt in.
    if (user?.kind === 'staff') {
      const staffRoute =
        (required ?? []).includes(Permission.AdminAccess) ||
        this.reflector.getAllAndOverride<boolean>(ALLOW_STAFF_KEY, targets) === true;
      if (!staffRoute) {
        throw new ForbiddenException('Back-office sessions cannot use this route.');
      }
    }

    if (!required || required.length === 0) {
      return true;
    }
    if (!user) {
      throw new ForbiddenException('Authentication required.');
    }

    const held = new Set(user.permissions);
    const missing = required.filter((permission) => !held.has(permission));
    if (missing.length > 0) {
      throw new ForbiddenException(`Missing permission(s): ${missing.join(', ')}.`);
    }
    return true;
  }
}
