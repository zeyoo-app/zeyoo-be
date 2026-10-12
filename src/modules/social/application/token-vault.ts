import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const SEPARATOR = '.';

/**
 * Encrypts platform tokens at rest (AES-256-GCM) and signs short-lived OAuth state
 * with the same key. A vault built without a key reports itself unavailable instead
 * of storing tokens in the clear.
 */
export class TokenVault {
  private readonly key: Buffer | null;

  constructor(rawKey: string | undefined) {
    this.key = parseKey(rawKey);
  }

  isAvailable(): boolean {
    return this.key !== null;
  }

  encrypt(plaintext: string): string {
    const key = this.requireKey();
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), encrypted]
      .map((part) => part.toString('base64'))
      .join(SEPARATOR);
  }

  decrypt(payload: string): string {
    const [iv, authTag, encrypted] = payload
      .split(SEPARATOR)
      .map((part) => Buffer.from(part, 'base64'));
    const decipher = createDecipheriv(ALGORITHM, this.requireKey(), iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  }

  sign(value: string): string {
    return `${value}${SEPARATOR}${this.signature(value)}`;
  }

  /** Returns the signed value, or null when the signature does not match. */
  verify(signed: string): string | null {
    const separatorIndex = signed.lastIndexOf(SEPARATOR);
    if (separatorIndex < 0) {
      return null;
    }
    const value = signed.slice(0, separatorIndex);
    const provided = Buffer.from(signed.slice(separatorIndex + 1));
    const expected = Buffer.from(this.signature(value));
    return provided.length === expected.length && timingSafeEqual(provided, expected)
      ? value
      : null;
  }

  private signature(value: string): string {
    return createHmac('sha256', this.requireKey()).update(value).digest('base64url');
  }

  private requireKey(): Buffer {
    if (!this.key) {
      throw new Error('SOCIAL_TOKEN_ENCRYPTION_KEY is not configured.');
    }
    return this.key;
  }
}

function parseKey(rawKey: string | undefined): Buffer | null {
  if (!rawKey) {
    return null;
  }
  const decoded = /^[0-9a-f]{64}$/i.test(rawKey)
    ? Buffer.from(rawKey, 'hex')
    : Buffer.from(rawKey, 'base64');
  if (decoded.length !== KEY_BYTES) {
    throw new Error('SOCIAL_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes.');
  }
  return decoded;
}
