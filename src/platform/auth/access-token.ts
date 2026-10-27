import { Role } from '../rbac/roles';

/** Claims carried inside a signed access token. */
export interface AccessTokenClaims {
  sub: string;
  email: string | null;
  role: Role;
  /** Set on back-office tokens, whose subject is a staff account rather than a user. */
  kind?: 'staff';
}
