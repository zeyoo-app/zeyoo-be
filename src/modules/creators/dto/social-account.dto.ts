import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const platformSchema = z.enum(['TIKTOK', 'INSTAGRAM', 'YOUTUBE', 'X']);

export const connectSocialAccountSchema = z.object({
  platform: platformSchema,
  handle: z.string().min(1).max(80),
  platformAccountId: z.string().min(1).max(120).optional(),
});

export class ConnectSocialAccountDto extends createZodDto(connectSocialAccountSchema) {}
