import { StaffRole, UserType } from '@prisma/client';
import { Permission } from './permission';
import { permissionsForRole } from './roles';

describe('permissionsForRole', () => {
  it('lets creators manage their own profile but not organizations', () => {
    const permissions = permissionsForRole(UserType.CREATOR);

    expect(permissions).toContain(Permission.CreatorProfileManage);
    expect(permissions).not.toContain(Permission.OrgManage);
  });

  it('lets brand users manage their organization but not admin areas', () => {
    const permissions = permissionsForRole(UserType.BRAND_USER);

    expect(permissions).toContain(Permission.OrgManage);
    expect(permissions).toContain(Permission.OrgMembersManage);
    expect(permissions).not.toContain(Permission.AdminAccess);
  });

  it('gives the retired ADMIN user type no back-office access', () => {
    expect(permissionsForRole(UserType.ADMIN)).not.toContain(Permission.AdminAccess);
  });

  it('lets a super admin into the back office and manage staff', () => {
    const permissions = permissionsForRole(StaffRole.SUPER_ADMIN);

    expect(permissions).toContain(Permission.AdminAccess);
    expect(permissions).toContain(Permission.StaffManage);
  });

  it('lets an administrator into every area but not manage staff', () => {
    const permissions = permissionsForRole(StaffRole.ADMINISTRATOR);

    expect(permissions).toEqual(
      expect.arrayContaining([
        Permission.AdminPeople,
        Permission.AdminCampaigns,
        Permission.AdminFinance,
        Permission.AdminTrust,
        Permission.AdminSettings,
        Permission.AdminAudit,
      ]),
    );
    expect(permissions).not.toContain(Permission.StaffManage);
  });

  it('keeps support out of money, settings and staff', () => {
    const permissions = permissionsForRole(StaffRole.SUPPORT);

    expect(permissions).toContain(Permission.AdminPeople);
    expect(permissions).toContain(Permission.AdminTrust);
    expect(permissions).not.toContain(Permission.AdminFinance);
    expect(permissions).not.toContain(Permission.AdminSettings);
    expect(permissions).not.toContain(Permission.StaffManage);
  });

  it('keeps finance to money and the audit log', () => {
    const permissions = permissionsForRole(StaffRole.FINANCE);

    expect(permissions).toContain(Permission.AdminFinance);
    expect(permissions).toContain(Permission.AdminAudit);
    expect(permissions).not.toContain(Permission.AdminPeople);
    expect(permissions).not.toContain(Permission.StaffManage);
  });

  it('gives every staff role the back office, and no customer type a staff area', () => {
    for (const role of Object.values(StaffRole)) {
      expect(permissionsForRole(role)).toContain(Permission.AdminAccess);
    }
    const staffOnly = [
      Permission.AdminAccess,
      Permission.AdminPeople,
      Permission.AdminFinance,
      Permission.StaffManage,
    ];
    for (const type of Object.values(UserType)) {
      for (const permission of staffOnly) {
        expect(permissionsForRole(type)).not.toContain(permission);
      }
    }
  });
});
