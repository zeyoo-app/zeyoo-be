import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Typed confirmation so a stray request cannot erase an account.
export const deleteAccountSchema = z.object({ confirmation: z.literal('DELETE') });

export class DeleteAccountDto extends createZodDto(deleteAccountSchema) {}
