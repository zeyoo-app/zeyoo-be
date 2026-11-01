/**
 * The brand wallet: a prepaid balance held by Zeyoo (in its Stripe balance) and owed to
 * the brand until spent on campaigns. Closed-loop by design: it can only fund campaigns,
 * there are no withdrawals and no transfers between brands.
 */
export const WALLET_CURRENCY = 'USD';

/** $50: keeps Stripe's per-payment fee a small share of a top-up. */
export const MIN_TOP_UP_MINOR = 5_000;
/** $25,000 per payment; larger amounts can be paid in several top-ups. */
export const MAX_TOP_UP_MINOR = 2_500_000;
