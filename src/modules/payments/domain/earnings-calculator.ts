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

const VIEWS_PER_REWARD_UNIT = 1_000n;

export interface CreatorEntitlementInput {
  rewardType: 'PER_VIEW' | 'FIXED_PER_ITEM';
  /** Per 1,000 views for PER_VIEW; per approved item for FIXED_PER_ITEM. */
  reward: Money;
  /** Latest verified views across the creator's posts for the campaign. */
  views: number;
  /** The most one creator may earn from the campaign; null means no limit. */
  maxPerCreator: Money | null;
}

/**
 * What a creator has earned in total so far, before the campaign budget is
 * considered. Rounds down to a whole minor unit so the platform never pays more
 * than the rate promises.
 */
export function calculateCreatorEntitlement(input: CreatorEntitlementInput): Money {
  if (!Number.isInteger(input.views) || input.views < 0) {
    throw new Error('Views must be a non-negative integer.');
  }
  const gross = Money.of(grossMinor(input), input.reward.currencyCode);
  return input.maxPerCreator ? Money.min(gross, input.maxPerCreator) : gross;
}

function grossMinor({ rewardType, reward, views }: CreatorEntitlementInput): number {
  if (rewardType === 'FIXED_PER_ITEM') {
    return reward.amountMinor;
  }
  // BigInt keeps rate × views exact for very large view counts.
  return Number((BigInt(reward.amountMinor) * BigInt(views)) / VIEWS_PER_REWARD_UNIT);
}
