import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const registerDeviceSchema = z.object({
  token: z.string().min(1).max(512),
  platform: z.enum(['ios', 'android']),
});

export class RegisterDeviceDto extends createZodDto(registerDeviceSchema) {}
