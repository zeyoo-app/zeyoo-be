import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const inviteCreatorSchema = z.object({
  creatorEmail: z.string().email(),
});

export class InviteCreatorDto extends createZodDto(inviteCreatorSchema) {}
