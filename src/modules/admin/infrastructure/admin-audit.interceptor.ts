import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { Principal } from '@platform/auth';
import { PrismaService } from '@platform/database/prisma.service';

const ADMIN_PATH = '/admin/';
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const MAX_BODY_CHARS = 2000;

/** Writes one audit row for every successful state-changing request under /admin. */
@Injectable()
export class AdminAuditInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request & { user?: Principal }>();
    const route = request.route?.path as string | undefined;
    const audited =
      route !== undefined && route.includes(ADMIN_PATH) && !READ_METHODS.has(request.method);
    if (!audited) {
      return next.handle();
    }
    return next.handle().pipe(
      tap(() => {
        const adminUserId = request.user?.userId;
        if (!adminUserId) {
          return;
        }
        void this.prisma.adminAuditLog
          .create({
            data: {
              adminUserId,
              method: request.method,
              route,
              params: request.params as object,
              body: this.boundedBody(request.body),
            },
          })
          .catch(() => undefined);
      }),
    );
  }

  private boundedBody(body: unknown): object | undefined {
    if (!body || typeof body !== 'object') {
      return undefined;
    }
    return JSON.stringify(body).length > MAX_BODY_CHARS ? { truncated: true } : (body as object);
  }
}
