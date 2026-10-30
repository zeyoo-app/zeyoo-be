import { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';

import { PLAN_CATALOG, type PlanDefinition } from '../src/modules/entitlements/domain/plan-catalog';

const CURRENCY_CODE = 'USD';

/**
 * Writes every tier from the plan catalog. Paid tiers are billed by a Stripe Price
 * found by its lookup key — created on first run (USD, with a SAR currency option so
 * Checkout charges Saudi brands in Riyals) — so re-running is safe and changes nothing.
 * Without STRIPE_SECRET_KEY the paid tiers are written but not purchasable.
 */
export async function seedPlans(prisma: PrismaClient): Promise<void> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const stripe = secretKey ? new Stripe(secretKey) : null;
  if (!stripe) {
    console.warn('STRIPE_SECRET_KEY not set: paid plans are seeded without a Stripe price.');
  }

  for (const plan of PLAN_CATALOG) {
    const stripePriceId =
      stripe && plan.lookupKey ? await ensureStripePrice(stripe, plan, plan.lookupKey) : null;
    const data = {
      name: plan.name,
      priceMinor: plan.priceMinorUsd,
      priceMinorSar: plan.priceMinorSar,
      currencyCode: CURRENCY_CODE,
      maxActiveCampaigns: plan.maxActiveCampaigns,
      platformFeeBps: plan.platformFeeBps,
      allowsPrivateCampaigns: plan.allowsPrivateCampaigns,
      ...(stripePriceId ? { stripePriceId } : {}),
    };
    await prisma.plan.upsert({
      where: { key: plan.key },
      update: data,
      create: { key: plan.key, ...data },
    });
  }
}

async function ensureStripePrice(
  stripe: Stripe,
  plan: PlanDefinition,
  lookupKey: string,
): Promise<string> {
  const existing = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  if (existing.data[0]) {
    return existing.data[0].id;
  }
  const product = await stripe.products.create({
    name: `Zeyoo ${plan.name}`,
    metadata: { planKey: plan.key },
  });
  const price = await stripe.prices.create({
    product: product.id,
    lookup_key: lookupKey,
    currency: 'usd',
    unit_amount: plan.priceMinorUsd,
    currency_options: { sar: { unit_amount: plan.priceMinorSar } },
    recurring: { interval: 'month' },
    metadata: { planKey: plan.key },
  });
  return price.id;
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seedPlans(prisma)
    .then(() => prisma.$disconnect())
    .catch(async (error) => {
      console.error(error);
      await prisma.$disconnect();
      process.exit(1);
    });
}
