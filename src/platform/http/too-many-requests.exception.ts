import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * 429 Too Many Requests. Nest ships no named class for this status, so this keeps
 * the call sites readable and the response shape identical to every other error the
 * API returns. Used to slow down SMS pumping and code guessing. When the caller can
 * retry after a known delay, `retryAfterSeconds` lets a client show a countdown.
 */
export class TooManyRequestsException extends HttpException {
  constructor(message = 'Too many requests. Please try again later.', retryAfterSeconds?: number) {
    super(
      retryAfterSeconds === undefined ? message : { message, retryAfterSeconds },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
