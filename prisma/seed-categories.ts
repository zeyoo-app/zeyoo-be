import { PrismaClient } from '@prisma/client';

/**
 * Campaign categories double as the industry list shown during brand onboarding, so a
 * database without them blocks every new brand from finishing setup. Upserted by slug,
 * which makes re-running safe and lets a name be corrected later without duplicates.
 */
export const INDUSTRIES = [
  'Beauty & Skincare',
  'Fashion & Apparel',
  'Food & Beverage',
  'Health & Wellness',
  'Fitness & Sports',
  'Technology & Apps',
  'Gaming & Esports',
  'Travel & Hospitality',
  'Finance & Fintech',
  'Education & E-learning',
  'Entertainment & Media',
  'Music & Audio',
  'E-commerce & Retail',
  'Home & Lifestyle',
  'Automotive',
  'Real Estate',
  'Parenting & Family',
  'Pets',
  'Non-profit & Causes',
  'Other',
];

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export async function seedCategories(prisma: PrismaClient): Promise<number> {
  for (const name of INDUSTRIES) {
    const slug = slugify(name);
    await prisma.category.upsert({ where: { slug }, update: { name }, create: { name, slug } });
  }
  return INDUSTRIES.length;
}

// Runnable on its own (`pnpm seed:categories`) so production can get the reference data
// without the development admin user that the full seed creates.
if (require.main === module) {
  const prisma = new PrismaClient();
  seedCategories(prisma)
    .then(async (count) => {
      console.log(`Seeded ${count} industries.`);
      await prisma.$disconnect();
    })
    .catch(async (error) => {
      console.error(error);
      await prisma.$disconnect();
      process.exit(1);
    });
}
