import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();

    const { status, message } = this.resolve(exception);
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(`${request.method} ${request.url}`, exception as Error);
    }

    const body: ErrorBody = {
      statusCode: status,
      error: HttpStatus[status] ?? 'ERROR',
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
    };
    response.status(status).json(body);
  }

  private resolve(exception: unknown): { status: number; message: string | string[] } {
    if (exception instanceof HttpException) {
      return { status: exception.getStatus(), message: this.extractMessage(exception) };
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.resolvePrisma(exception);
    }
    return { status: HttpStatus.INTERNAL_SERVER_ERROR, message: 'Internal server error.' };
  }

  private extractMessage(exception: HttpException): string | string[] {
    const payload = exception.getResponse();
    if (typeof payload === 'string') {
      return payload;
    }
    const message = (payload as { message?: string | string[] }).message;
    return message ?? exception.message;
  }

  private resolvePrisma(
    exception: Prisma.PrismaClientKnownRequestError,
  ): { status: number; message: string } {
    switch (exception.code) {
      case 'P2002':
        return { status: HttpStatus.CONFLICT, message: 'Resource already exists.' };
      case 'P2025':
        return { status: HttpStatus.NOT_FOUND, message: 'Resource not found.' };
      default:
        return { status: HttpStatus.BAD_REQUEST, message: 'Database request error.' };
    }
  }
}
