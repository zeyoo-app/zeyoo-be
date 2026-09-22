import { Money } from './money';

describe('Money', () => {
  it('rejects non-integer minor amounts', () => {
    expect(() => Money.of(10.5, 'USD')).toThrow();
  });

  it('rejects invalid currency codes', () => {
    expect(() => Money.of(100, 'usd')).toThrow();
    expect(() => Money.of(100, 'DOLLAR')).toThrow();
  });

  it('adds and subtracts within the same currency', () => {
    expect(Money.of(100, 'USD').add(Money.of(50, 'USD')).amountMinor).toBe(150);
    expect(Money.of(100, 'USD').subtract(Money.of(30, 'USD')).amountMinor).toBe(70);
  });

  it('refuses to operate across currencies', () => {
    expect(() => Money.of(100, 'USD').add(Money.of(50, 'EUR'))).toThrow();
  });

  it('returns the smaller amount from min', () => {
    expect(Money.min(Money.of(100, 'USD'), Money.of(40, 'USD')).amountMinor).toBe(40);
  });
});
