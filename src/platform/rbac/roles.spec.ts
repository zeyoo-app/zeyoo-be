import { UserType } from '@prisma/client';
import { Permission } from './permission';
import { permissionsForRole } from './roles';

describe('permissionsForRole', () => {
  it('grants creators no organization permissions', () => {
    expect(permissionsForRole(UserType.CREATOR)).toEqual([]);
  });

  it('lets brand users manage their organization but not admin areas', () => {
    const permissions = permissionsForRole(UserType.BRAND_USER);

    expect(permissions).toContain(Permission.OrgManage);
    expect(permissions).toContain(Permission.OrgMembersManage);
    expect(permissions).not.toContain(Permission.AdminAccess);
  });

  it('grants admins every brand permission plus admin access', () => {
    const permissions = permissionsForRole(UserType.ADMIN);

    expect(permissions).toContain(Permission.OrgManage);
    expect(permissions).toContain(Permission.AdminAccess);
  });
});
