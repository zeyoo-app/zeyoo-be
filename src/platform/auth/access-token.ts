import { UserType } from '@prisma/client';

/** Claims carried inside a signed access token. */
export interface AccessTokenClaims {
  sub: string;
  email: string;
  role: UserType;
}
