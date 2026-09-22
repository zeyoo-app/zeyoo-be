import { PrismaClient, UserType } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const ADMIN_EMAIL = 'admin@zeyoo.local';
const ADMIN_PASSWORD = 'change-me-admin-password';

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
      credential: { create: { passwordHash: await argon2.hash(ADMIN_PASSWORD) } },
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
