import { HttpException, HttpStatus } from '@nestjs/common';
import { AgentOutputError } from '../agent/agent-runner';
import { LlmError } from '../llm/llm.types';

/** What clients see when an assistant run fails: a stable code and a plain message. */
export interface AiFailure {
  status: number;
  code: string;
  message: string;
  retryable: boolean;
}

const RATE_LIMIT_RETRY_SECONDS = 10;
// Not a standard status: the client went away, so nobody reads the response.
const CLIENT_CLOSED_REQUEST = 499;

export function describeAiFailure(error: unknown): AiFailure {
  if (error instanceof AgentOutputError) {
    return {
      status: HttpStatus.BAD_GATEWAY,
      code: 'AI_BAD_OUTPUT',
      message: 'The AI assistant returned an incomplete answer. Please try again.',
      retryable: true,
    };
  }
  if (!(error instanceof LlmError)) {
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'AI_FAILED',
      message: 'The AI assistant failed. Please try again.',
      retryable: true,
    };
  }
  switch (error.code) {
    case 'NOT_CONFIGURED':
    case 'AUTH':
    case 'BILLING':
    case 'MODEL_NOT_FOUND':
      // Staff must act; the detail is logged, users get a plain message.
      return {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        code: `AI_${error.code}`,
        message: 'The AI assistant is not available right now.',
        retryable: false,
      };
    case 'RATE_LIMITED':
      return {
        status: HttpStatus.TOO_MANY_REQUESTS,
        code: 'AI_RATE_LIMITED',
        message: 'The AI assistant is busy. Try again in a few seconds.',
        retryable: true,
      };
    case 'TIMEOUT':
      return {
        status: HttpStatus.GATEWAY_TIMEOUT,
        code: 'AI_TIMEOUT',
        message: 'The AI assistant took too long. Please try again.',
        retryable: true,
      };
    case 'CANCELLED':
      return {
        status: CLIENT_CLOSED_REQUEST,
        code: 'AI_CANCELLED',
        message: 'Cancelled.',
        retryable: true,
      };
    case 'REFUSED':
      return {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        code: 'AI_REFUSED',
        message: 'The AI assistant could not help with that request. Try rewording it.',
        retryable: false,
      };
    default:
      return {
        status: HttpStatus.BAD_GATEWAY,
        code: `AI_${error.code}`,
        message: 'The AI assistant is not available right now. Please try again.',
        retryable: error.retryable,
      };
  }
}

export function toHttpException(error: unknown): HttpException {
  const failure = describeAiFailure(error);
  return new HttpException(
    {
      message: failure.message,
      code: failure.code,
      ...(failure.code === 'AI_RATE_LIMITED'
        ? { retryAfterSeconds: RATE_LIMIT_RETRY_SECONDS }
        : {}),
    },
    failure.status,
  );
}
