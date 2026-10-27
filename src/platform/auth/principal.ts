import { Permission } from '../rbac/permission';
import { Role } from '../rbac/roles';

/** The authenticated caller, resolved from a verified access token. */
export interface Principal {
  /** A user id, or a staff account id when `kind` is 'staff'. */
  userId: string;
  /** Null for accounts created from a phone number alone. */
  email: string | null;
  role: Role;
  /** 'staff' for back-office sessions, which only reach staff routes. */
  kind: 'user' | 'staff';
  permissions: Permission[];
}
