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

// Back-office roles. Each opens the areas its job needs; only a super admin manages staff.
const ADMIN_PERMISSIONS: Permission[] = [
  Permission.AdminAccess,
  Permission.AdminPeople,
  Permission.AdminCampaigns,
  Permission.AdminFinance,
  Permission.AdminTrust,
  Permission.AdminSettings,
  Permission.AdminAudit,
];
const SUPER_ADMIN_PERMISSIONS: Permission[] = [...ADMIN_PERMISSIONS, Permission.StaffManage];
const SUPPORT_PERMISSIONS: Permission[] = [
  Permission.AdminAccess,
  Permission.AdminPeople,
  Permission.AdminCampaigns,
  Permission.AdminTrust,
];
const FINANCE_PERMISSIONS: Permission[] = [
  Permission.AdminAccess,
  Permission.AdminFinance,
  Permission.AdminAudit,
];

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  [UserType.BRAND_USER]: BRAND_PERMISSIONS,
  [UserType.CREATOR]: CREATOR_PERMISSIONS,
  // Retired: back-office access now comes from a staff account, never a user type.
  [UserType.ADMIN]: [],
  [StaffRole.SUPER_ADMIN]: SUPER_ADMIN_PERMISSIONS,
  [StaffRole.ADMINISTRATOR]: ADMIN_PERMISSIONS,
  [StaffRole.SUPPORT]: SUPPORT_PERMISSIONS,
  [StaffRole.FINANCE]: FINANCE_PERMISSIONS,
};

export function permissionsForRole(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role];
}
