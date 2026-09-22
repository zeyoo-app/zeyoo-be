import { Permission } from '../rbac/permission';
import { Role } from '../rbac/roles';

/** The authenticated caller, resolved from a verified access token. */
export interface Principal {
  userId: string;
  email: string;
  role: Role;
  permissions: Permission[];
}
