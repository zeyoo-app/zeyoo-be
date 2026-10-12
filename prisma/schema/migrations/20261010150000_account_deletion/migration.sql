-- AlterEnum
ALTER TYPE "UserStatus" ADD VALUE 'DELETED';

-- AlterTable
ALTER TABLE "iam_users" ADD COLUMN "deletedAt" TIMESTAMP(3);
