import { isDeliverablePhone, isE164, normalizePhone } from './phone-number';

/**
 * Phone validation guards the only credential a user without an email can hold, so
 * these assert real libphonenumber behaviour rather than a regex shape. Two cases
 * are deliberately stricter than the regex this replaced: a fictional 555 range and
 * a correctly-shaped but truncated number are both refused, because either would
 * otherwise be accepted and then silently never receive a code.
 */
describe('normalizePhone', () => {
  it('leaves a number already in E.164 alone', () => {
    expect(normalizePhone('+971501234567')).toBe('+971501234567');
  });

  it('strips the grouping punctuation a client might send', () => {
    expect(normalizePhone('+971 50 123 4567')).toBe('+971501234567');
    expect(normalizePhone('  +1.415.555.2671  ')).toBe('+14155552671');
  });

  it('refuses to guess a country from a bare national number', () => {
    // Previously digits-only input was accepted and blindly prefixed with `+`,
    // which could attach the wrong calling code and text a different subscriber.
    expect(normalizePhone('15551234567')).toBe('');
    expect(normalizePhone('501234567')).toBe('');
  });

  it('reads a blank field as no number', () => {
    expect(normalizePhone('')).toBe('');
    expect(normalizePhone('   ')).toBe('');
  });

  it('always produces a well-formed E.164 number when it produces anything', () => {
    for (const input of ['+971501234567', '+447911123456', '+919876543210', '+14155552671']) {
      expect(isE164(normalizePhone(input))).toBe(true);
    }
  });
});

describe('isDeliverablePhone', () => {
  it('accepts real numbers from the launch market and beyond', () => {
    expect(isDeliverablePhone('+971501234567')).toBe(true);
    expect(isDeliverablePhone('+966512345678')).toBe(true);
    expect(isDeliverablePhone('+447911123456')).toBe(true);
    expect(isDeliverablePhone('+919876543210')).toBe(true);
    expect(isDeliverablePhone('+14155552671')).toBe(true);
  });

  it('rejects a range that is not assigned to any subscriber', () => {
    expect(isDeliverablePhone('+15551234567')).toBe(false);
  });

  it('rejects a correctly-shaped but truncated number', () => {
    expect(isDeliverablePhone('+97150123')).toBe(false);
  });

  it('rejects numbers that are too short or too long', () => {
    expect(isDeliverablePhone('+15551')).toBe(false);
    expect(isDeliverablePhone(`+971${'5'.repeat(15)}`)).toBe(false);
  });

  it('rejects a bare national number rather than assuming a country', () => {
    expect(isDeliverablePhone('15551234567')).toBe(false);
  });
});
