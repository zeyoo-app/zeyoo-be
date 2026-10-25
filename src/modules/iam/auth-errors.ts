import { ConflictException, NotFoundException } from '@nestjs/common';

/** Machine-readable reasons the clients branch on (the message is for people). */
export const AUTH_ERROR = {
  accountNotFound: 'ACCOUNT_NOT_FOUND',
  accountTypeRequired: 'ACCOUNT_TYPE_REQUIRED',
} as const;

/** Signing in with an address or number that has no account: send them to create one. */
export function accountNotFound(kind: 'email' | 'phone'): NotFoundException {
  return new NotFoundException({
    code: AUTH_ERROR.accountNotFound,
    message:
      kind === 'email'
        ? 'There is no Zeyoo account with this email. Create an account to get started.'
        : 'There is no Zeyoo account with this phone number. Create an account to get started.',
  });
}

/** A first-time social sign-in: the person must say whether they are a creator or a brand. */
export function accountTypeRequired(): ConflictException {
  return new ConflictException({
    code: AUTH_ERROR.accountTypeRequired,
    message: 'Choose whether you are joining as a creator or a brand.',
  });
}
