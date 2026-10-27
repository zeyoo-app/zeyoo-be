import { StaffRole, UserType } from '@prisma/client';
import { Permission } from './permission';

/** A user's account type, or a staff member's back-office role. */
export type Role = UserType | StaffRole;

const BRAND_PERMISSIONS: Permission[] = [
  Permission.OrgManage,
  Permission.OrgMembersManage,
  Permission.ApiKeyManage,
  Permission.CampaignManage,
  Permission.MediaUpload,
];

const CREATOR_PERMISSIONS: Permission[] = [
  Permission.CreatorProfileManage,
  Permission.CampaignApply,
  Permission.ContentSubmit,
  Permission.WithdrawalRequest,
  Permission.MediaUpload,
];

const SUPER_ADMIN_PERMISSIONS: Permission[] = [Permission.AdminAccess, Permission.StaffManage];

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  [UserType.BRAND_USER]: BRAND_PERMISSIONS,
  [UserType.CREATOR]: CREATOR_PERMISSIONS,
  // Retired: back-office access now comes from a staff account, never a user type.
  [UserType.ADMIN]: [],
  [StaffRole.SUPER_ADMIN]: SUPER_ADMIN_PERMISSIONS,
};

export function permissionsForRole(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role];
}
