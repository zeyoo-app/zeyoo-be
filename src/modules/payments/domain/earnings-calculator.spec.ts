import { calculateEarnings } from './earnings-calculator';
import { Money } from './money';

describe('calculateEarnings', () => {
  it('multiplies the rate by the number of units', () => {
    const earned = calculateEarnings({
      ratePerUnit: Money.of(500, 'USD'),
      units: 3,
      budgetRemaining: Money.of(100_000, 'USD'),
    });

    expect(earned.amountMinor).toBe(1_500);
  });

  it('caps earnings at the remaining budget', () => {
    const earned = calculateEarnings({
      ratePerUnit: Money.of(500, 'USD'),
      units: 100,
      budgetRemaining: Money.of(2_000, 'USD'),
    });

    expect(earned.amountMinor).toBe(2_000);
  });

  it('earns nothing for zero units', () => {
    const earned = calculateEarnings({
      ratePerUnit: Money.of(500, 'USD'),
      units: 0,
      budgetRemaining: Money.of(2_000, 'USD'),
    });

    expect(earned.amountMinor).toBe(0);
  });

  it('rejects a negative unit count', () => {
    expect(() =>
      calculateEarnings({
        ratePerUnit: Money.of(500, 'USD'),
        units: -1,
        budgetRemaining: Money.of(2_000, 'USD'),
      }),
    ).toThrow();
  });
});
