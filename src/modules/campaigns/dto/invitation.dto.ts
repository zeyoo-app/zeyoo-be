import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// A brand invites a creator either by email or, from the creator directory, by id.
export const inviteCreatorSchema = z
  .object({
    creatorEmail: z.string().email().optional(),
    creatorUserId: z.string().uuid().optional(),
  })
  .refine((value) => Boolean(value.creatorEmail) !== Boolean(value.creatorUserId), {
    message: 'Provide either creatorEmail or creatorUserId.',
    path: ['creatorEmail'],
  });

export class InviteCreatorDto extends createZodDto(inviteCreatorSchema) {}
