import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { isDeliverablePhone, normalizePhone } from '../phone-number';

// Lower-cased and trimmed so one address always maps to one account and one code row.
const email = z.string().trim().toLowerCase().email().max(254);

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const CODE_LENGTH = 6;
const verificationCode = z.string().length(CODE_LENGTH).regex(/^\d+$/, 'Code must be 6 digits.');

// 'sign_in' refuses an address with no account (so nobody is silently signed up);
// 'sign_up' (the create-account screen) sends a code either way. Older app builds send
// neither and keep the original combined behaviour.
const intent = z.enum(['sign_in', 'sign_up']).optional();

export const requestEmailCodeSchema = z.object({ email, intent });

export const verifyEmailCodeSchema = z.object({
  email,
  code: verificationCode,
  // Required to create an account (the create-account screen sends it); without it a
  // new address is refused rather than silently made a creator. A returning user's
  // stored role always wins.
  userType: z.enum(['BRAND_USER', 'CREATOR']).optional(),
});

export const oauthSignInSchema = z.object({
  idToken: z.string().min(1),
  // Only needed the first time; without it a brand-new person is asked to choose.
  userType: z.enum(['BRAND_USER', 'CREATOR']).optional(),
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
  intent,
});

export const verifyPhoneCodeSchema = z.object({
  phone,
  code: verificationCode,
  // Only consulted when the number has no account yet; a returning user's stored
  // role always wins.
  userType: z.enum(['BRAND_USER', 'CREATOR']).optional(),
});

export const requestStaffCodeSchema = z.object({ email });

export const verifyStaffCodeSchema = z.object({ email, code: verificationCode });

export class RefreshDto extends createZodDto(refreshSchema) {}
export class LogoutDto extends createZodDto(refreshSchema) {}
export class RequestEmailCodeDto extends createZodDto(requestEmailCodeSchema) {}
export class VerifyEmailCodeDto extends createZodDto(verifyEmailCodeSchema) {}
export class OAuthSignInDto extends createZodDto(oauthSignInSchema) {}
export class RequestPhoneCodeDto extends createZodDto(requestPhoneCodeSchema) {}
export class VerifyPhoneCodeDto extends createZodDto(verifyPhoneCodeSchema) {}
export class RequestStaffCodeDto extends createZodDto(requestStaffCodeSchema) {}
export class VerifyStaffCodeDto extends createZodDto(verifyStaffCodeSchema) {}
