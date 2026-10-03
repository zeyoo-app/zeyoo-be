import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { isDeliverablePhone, normalizePhone } from '../phone-number';

// Lower-cased and trimmed so one address always maps to one account and one code row.
const email = z
  .string()
  .trim()
  .toLowerCase()
  .email()
  .max(254);

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const CODE_LENGTH = 6;
const verificationCode = z.string().length(CODE_LENGTH).regex(/^\d+$/, 'Code must be 6 digits.');

export const requestEmailCodeSchema = z.object({ email });

export const verifyEmailCodeSchema = z.object({
  email,
  code: verificationCode,
  // Only consulted when the address has no account yet; a returning user's stored
  // role always wins.
  userType: z.enum(['BRAND_USER', 'CREATOR']).optional(),
});

export const oauthSignInSchema = z.object({
  idToken: z.string().min(1),
  userType: z.enum(['BRAND_USER', 'CREATOR']),
});

// Accepts whatever the user typed — "+1 (555) 123-4567" is as reasonable as
// International format only — the client resolves the country from its picker and
// sends E.164, and canonicalising here means the service only ever sees, and only
// ever stores, one spelling of a given number. A bare national number is refused
// rather than guessed at, and so is one no gateway could deliver.
const phone = z
  .string()
  .min(6, 'Enter a phone number with its country code.')
  .transform(normalizePhone)
  .refine(isDeliverablePhone, {
    message: 'Enter a valid phone number with its country code, e.g. +971501234567.',
  });

export const requestPhoneCodeSchema = z.object({
  phone,
});

export const verifyPhoneCodeSchema = z.object({
  phone,
  code: verificationCode,
  // Only consulted when the number has no account yet; a returning user's stored
  // role always wins.
  userType: z.enum(['BRAND_USER', 'CREATOR']).optional(),
});

export class RefreshDto extends createZodDto(refreshSchema) {}
export class LogoutDto extends createZodDto(refreshSchema) {}
export class RequestEmailCodeDto extends createZodDto(requestEmailCodeSchema) {}
export class VerifyEmailCodeDto extends createZodDto(verifyEmailCodeSchema) {}
export class OAuthSignInDto extends createZodDto(oauthSignInSchema) {}
export class RequestPhoneCodeDto extends createZodDto(requestPhoneCodeSchema) {}
export class VerifyPhoneCodeDto extends createZodDto(verifyPhoneCodeSchema) {}
