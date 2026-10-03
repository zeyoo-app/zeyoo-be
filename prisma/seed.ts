import { PrismaClient, UserType } from '@prisma/client';

const prisma = new PrismaClient();

const ADMIN_EMAIL = 'admin@zeyoo.local';

async function seedAdmin(): Promise<void> {
  const existing = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
  if (existing) {
    return;
  }
  await prisma.user.create({
    data: {
      email: ADMIN_EMAIL,
      type: UserType.ADMIN,
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });
}

seedAdmin()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
