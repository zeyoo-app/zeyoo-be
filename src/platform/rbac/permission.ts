/**
 * Coarse, platform-level permissions checked by guards at the HTTP edge.
 * Resource-scoped rules (e.g. "must be the OWNER of *this* organization") are
 * enforced inside module services, not here.
 */
export const Permission = {
  OrgManage: 'org:manage',
  OrgMembersManage: 'org:members:manage',
  ApiKeyManage: 'apikey:manage',
  CampaignManage: 'campaign:manage',
  AdminAccess: 'admin:access',
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];
