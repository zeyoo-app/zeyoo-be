import { randomBytes } from 'crypto';
import { TokenVault } from './token-vault';

const KEY = randomBytes(32).toString('base64');

describe('TokenVault', () => {
  it('round-trips a token through encryption', () => {
    const vault = new TokenVault(KEY);

    const stored = vault.encrypt('secret-access-token');

    expect(stored).not.toContain('secret-access-token');
    expect(vault.decrypt(stored)).toBe('secret-access-token');
  });

  it('rejects a tampered ciphertext', () => {
    const vault = new TokenVault(KEY);
    const [iv, tag, data] = vault.encrypt('token').split('.');
    const tampered = [iv, tag, Buffer.from('x').toString('base64') + data].join('.');

    expect(() => vault.decrypt(tampered)).toThrow();
  });

  it('verifies its own signatures and rejects altered values', () => {
    const vault = new TokenVault(KEY);
    const signed = vault.sign('state-payload');

    expect(vault.verify(signed)).toBe('state-payload');
    expect(vault.verify(signed.replace('state', 'other'))).toBeNull();
  });

  it('is unavailable without a key and refuses to encrypt', () => {
    const vault = new TokenVault(undefined);

    expect(vault.isAvailable()).toBe(false);
    expect(() => vault.encrypt('token')).toThrow();
  });

  it('rejects a key of the wrong length', () => {
    expect(() => new TokenVault('c2hvcnQ=')).toThrow();
  });
});
