import { PrismaClient } from '@prisma/client';
import { seedCategories } from './seed-categories';
import { seedPlans } from './seed-plans';

const prisma = new PrismaClient();

// The first back-office account. Every other staff member is added by a super admin.
const SUPER_ADMIN_EMAIL = 'abdulsalamabodunrin369@gmail.com';

async function seedSuperAdmin(): Promise<void> {
  await prisma.staffAccount.upsert({
    where: { email: SUPER_ADMIN_EMAIL },
    update: { role: 'SUPER_ADMIN', status: 'ACTIVE' },
    create: { email: SUPER_ADMIN_EMAIL, role: 'SUPER_ADMIN' },
  });
}

seedSuperAdmin()
  .then(() => seedCategories(prisma))
  .then(() => seedPlans(prisma))
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
