import { UserType } from '@prisma/client';
import { Permission } from './permission';

/** A platform role is the user's account type. */
export type Role = UserType;

const BRAND_PERMISSIONS: Permission[] = [
  Permission.OrgManage,
  Permission.OrgMembersManage,
  Permission.ApiKeyManage,
  Permission.CampaignManage,
];

const CREATOR_PERMISSIONS: Permission[] = [Permission.CreatorProfileManage];

const ADMIN_PERMISSIONS: Permission[] = [...BRAND_PERMISSIONS, Permission.AdminAccess];

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  [UserType.BRAND_USER]: BRAND_PERMISSIONS,
  [UserType.CREATOR]: CREATOR_PERMISSIONS,
  [UserType.ADMIN]: ADMIN_PERMISSIONS,
};

export function permissionsForRole(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role];
}
