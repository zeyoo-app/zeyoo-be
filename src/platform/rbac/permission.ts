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
  CampaignApply: 'campaign:apply',
  ContentSubmit: 'content:submit',
  WithdrawalRequest: 'withdrawal:request',
  CreatorProfileManage: 'creator:profile:manage',
  MediaUpload: 'media:upload',
  // Signs in to the back office and sees the overview; every staff role has it.
  AdminAccess: 'admin:access',
  // One per back-office area, so a staff role opens only the areas it covers.
  AdminPeople: 'admin:people',
  AdminCampaigns: 'admin:campaigns',
  AdminFinance: 'admin:finance',
  AdminTrust: 'admin:trust',
  AdminSettings: 'admin:settings',
  AdminAudit: 'admin:audit',
  StaffManage: 'admin:staff:manage',
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];
