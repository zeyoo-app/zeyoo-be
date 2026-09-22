import { UserType } from '@prisma/client';
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

  it('grants admins every brand permission plus admin access', () => {
    const permissions = permissionsForRole(UserType.ADMIN);

    expect(permissions).toContain(Permission.OrgManage);
    expect(permissions).toContain(Permission.AdminAccess);
  });
});
