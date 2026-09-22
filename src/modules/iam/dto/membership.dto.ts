import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const orgRoleSchema = z.enum(['OWNER', 'MEMBER']);

export const inviteMemberSchema = z.object({
  email: z.string().email(),
  role: orgRoleSchema,
});

export const updateMemberRoleSchema = z.object({
  role: orgRoleSchema,
});

export class InviteMemberDto extends createZodDto(inviteMemberSchema) {}
export class UpdateMemberRoleDto extends createZodDto(updateMemberRoleSchema) {}
