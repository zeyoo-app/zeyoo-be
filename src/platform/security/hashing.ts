import { createHash } from 'node:crypto';

/** SHA-256 hex digest — for hashing high-entropy secrets (tokens, API keys). */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
