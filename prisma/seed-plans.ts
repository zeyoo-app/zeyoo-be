import { PrismaClient } from '@prisma/client';

const PLAN_KEYS = ['starter', 'growth', 'scale'] as const;
const CURRENCY_CODE = 'USD';

interface PlanConfig {
  key: string;
  name: string;
  stripePriceId: string;
  priceMinor: number;
}

/**
 * The price lives in Stripe, so each plan is configured from the environment:
 * STRIPE_PRICE_ID_<KEY> (e.g. price_123) and PLAN_PRICE_MINOR_<KEY> (e.g. 4900).
 * A plan with either value missing is skipped, never seeded half-configured.
 */
function readPlanConfig(key: (typeof PLAN_KEYS)[number]): PlanConfig | null {
  const suffix = key.toUpperCase();
  const stripePriceId = process.env[`STRIPE_PRICE_ID_${suffix}`];
  const priceMinor = Number(process.env[`PLAN_PRICE_MINOR_${suffix}`]);
  if (!stripePriceId || !Number.isInteger(priceMinor) || priceMinor <= 0) {
    return null;
  }
  return { key, name: key[0].toUpperCase() + key.slice(1), stripePriceId, priceMinor };
}

export async function seedPlans(prisma: PrismaClient): Promise<void> {
  for (const key of PLAN_KEYS) {
    const config = readPlanConfig(key);
    if (!config) {
      console.warn(`Skipping plan "${key}": STRIPE_PRICE_ID_/PLAN_PRICE_MINOR_ not set.`);
      continue;
    }
    const { stripePriceId, priceMinor, name } = config;
    await prisma.plan.upsert({
      where: { key },
      update: { name, stripePriceId, priceMinor },
      create: { key, name, stripePriceId, priceMinor, currencyCode: CURRENCY_CODE },
    });
  }
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
