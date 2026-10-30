/**
 * The subscription tiers a brand can be on. Prices are set against the market: free
 * marketplaces take ~10% per campaign, paid tiers ($249–$500/month) cut that to 5–7%.
 * Stripe holds the billing prices (looked up by `lookupKey`); this catalog is what the
 * product enforces. A brand without an active subscription is on Starter.
 */
export interface PlanDefinition {
  key: PlanKey;
  name: string;
  /** Monthly price in minor units; 0 for the free tier. */
  priceMinorUsd: number;
  priceMinorSar: number;
  /** Stripe Price lookup key; null for the free tier, which has nothing to bill. */
  lookupKey: string | null;
  /** Campaigns that may be live at once; null = unlimited. */
  maxActiveCampaigns: number | null;
  /** Platform fee charged on top of each campaign budget, in basis points (1000 = 10%). */
  platformFeeBps: number;
  allowsPrivateCampaigns: boolean;
}

export type PlanKey = 'starter' | 'growth' | 'scale';

export const DEFAULT_PLAN_KEY: PlanKey = 'starter';

export const PLAN_CATALOG: readonly PlanDefinition[] = [
  {
    key: 'starter',
    name: 'Starter',
    priceMinorUsd: 0,
    priceMinorSar: 0,
    lookupKey: null,
    maxActiveCampaigns: 1,
    platformFeeBps: 1000,
    allowsPrivateCampaigns: false,
  },
  {
    key: 'growth',
    name: 'Growth',
    priceMinorUsd: 9900,
    priceMinorSar: 36900,
    lookupKey: 'zeyoo_growth_monthly',
    maxActiveCampaigns: 5,
    platformFeeBps: 700,
    allowsPrivateCampaigns: true,
  },
  {
    key: 'scale',
    name: 'Scale',
    priceMinorUsd: 29900,
    priceMinorSar: 111900,
    lookupKey: 'zeyoo_scale_monthly',
    maxActiveCampaigns: null,
    platformFeeBps: 500,
    allowsPrivateCampaigns: true,
  },
];

export function planDefinition(key: string): PlanDefinition | undefined {
  return PLAN_CATALOG.find((plan) => plan.key === key);
}
