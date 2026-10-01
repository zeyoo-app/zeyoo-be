import { Permission } from '../rbac/permission';
import { Role } from '../rbac/roles';

/** The authenticated caller, resolved from a verified access token. */
export interface Principal {
  userId: string;
  /** Null for accounts created from a phone number alone. */
  email: string | null;
  role: Role;
  permissions: Permission[];
}
