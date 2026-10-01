import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Nest ships no built-in 429, but the exception filter derives the error label
 * from `HttpStatus[status]`, so this renders as `TOO_MANY_REQUESTS` like every
 * other error the API returns. Used to slow down SMS pumping and code guessing.
 */
export class TooManyRequestsException extends HttpException {
  constructor(message = 'Too many requests. Please try again later.') {
    super(message, HttpStatus.TOO_MANY_REQUESTS);
  }
}
