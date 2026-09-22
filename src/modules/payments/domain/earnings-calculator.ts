import { Money } from './money';

export interface EarningsInput {
  /** Reward per unit — per approved item, or per view (the caller picks). */
  ratePerUnit: Money;
  /** Number of approved items, or number of views. */
  units: number;
  /** Remaining campaign budget; earnings are capped to it. */
  budgetRemaining: Money;
}

/**
 * Both contract methods (fixed-per-item and views × rate, §1.5) are the same
 * arithmetic — rate × quantity — differing only in what a "unit" means. The
 * result is always capped by the remaining campaign budget.
 */
export function calculateEarnings(input: EarningsInput): Money {
  if (!Number.isInteger(input.units) || input.units < 0) {
    throw new Error('Units must be a non-negative integer.');
  }
  const gross = Money.of(
    input.ratePerUnit.amountMinor * input.units,
    input.ratePerUnit.currencyCode,
  );
  return Money.min(gross, input.budgetRemaining);
}
