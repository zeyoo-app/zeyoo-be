import { parsePhoneNumberFromString } from 'libphonenumber-js/max';

/**
 * Phone numbers are stored and compared in E.164 form (`+971501234567`). Parsing
 * with Google's libphonenumber metadata — the same library the client uses, so both
 * sides agree on what a real number is — means the number in the database is the one
 * the user actually typed, and a number the SMS gateway could never reach is refused
 * at the edge rather than failing silently later.
 *
 * `/max` metadata is used for the same reason as on the client: the assigned-number
 * ranges are what make `isValid` able to tell a subscriber from a typo.
 */

/** Cheap post-condition on normalisation, in case a metadata change misbehaves. */
export const E164_PATTERN = /^\+[1-9]\d{6,14}$/;

export function isE164(input: string): boolean {
  return E164_PATTERN.test(input);
}

/**
 * The E.164 form of an internationally-formatted number, or `''` when the input is
 * not one. A bare national number yields `''` rather than a guess: ten digits could
 * be the US, Ghana, or anywhere else, and guessing risks texting a stranger.
 */
export function normalizePhone(input: string): string {
  return parsePhoneNumberFromString(input.trim())?.number ?? '';
}

/**
 * Whether the SMS gateway has a real chance of reaching this number. `isPossible`
 * is length-only and would pass a truncated number; `isValid` needs the assigned
 * ranges to reject one. A number rejected here is a better outcome than one that
 * silently never arrives, and the metadata is regenerated monthly upstream.
 */
export function isDeliverablePhone(input: string): boolean {
  const parsed = parsePhoneNumberFromString(input.trim());
  return parsed !== undefined && parsed.isPossible() && parsed.isValid();
}
