import { calculateCreatorEntitlement, calculateEarnings } from './earnings-calculator';
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

describe('calculateCreatorEntitlement', () => {
  const perThousandViews = Money.of(300, 'USD');

  it('pays the rate for every thousand views', () => {
    const entitlement = calculateCreatorEntitlement({
      rewardType: 'PER_VIEW',
      reward: perThousandViews,
      views: 10_000,
      maxPerCreator: null,
    });

    expect(entitlement.amountMinor).toBe(3_000);
  });

  it('rounds partial thousands down to a whole minor unit', () => {
    const entitlement = calculateCreatorEntitlement({
      rewardType: 'PER_VIEW',
      reward: perThousandViews,
      views: 1_234,
      maxPerCreator: null,
    });

    expect(entitlement.amountMinor).toBe(370);
  });

  it('caps what a single creator can earn', () => {
    const entitlement = calculateCreatorEntitlement({
      rewardType: 'PER_VIEW',
      reward: perThousandViews,
      views: 1_000_000,
      maxPerCreator: Money.of(5_000, 'USD'),
    });

    expect(entitlement.amountMinor).toBe(5_000);
  });

  it('pays a fixed reward once for an approved item regardless of views', () => {
    const entitlement = calculateCreatorEntitlement({
      rewardType: 'FIXED_PER_ITEM',
      reward: Money.of(2_500, 'USD'),
      views: 0,
      maxPerCreator: null,
    });

    expect(entitlement.amountMinor).toBe(2_500);
  });

  it('stays exact for very large view counts', () => {
    const entitlement = calculateCreatorEntitlement({
      rewardType: 'PER_VIEW',
      reward: Money.of(2_000_000_000, 'USD'),
      views: 2_000_000_000,
      maxPerCreator: null,
    });

    expect(entitlement.amountMinor).toBe(4_000_000_000_000_000);
  });

  it('rejects a negative view count', () => {
    expect(() =>
      calculateCreatorEntitlement({
        rewardType: 'PER_VIEW',
        reward: perThousandViews,
        views: -1,
        maxPerCreator: null,
      }),
    ).toThrow();
  });
});
