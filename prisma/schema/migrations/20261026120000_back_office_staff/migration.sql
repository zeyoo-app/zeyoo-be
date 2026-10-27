-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "StaffStatus" AS ENUM ('ACTIVE', 'DEACTIVATED');

-- CreateTable
CREATE TABLE "iam_staff_accounts" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL,
    "status" "StaffStatus" NOT NULL DEFAULT 'ACTIVE',
    "addedById" UUID,
    "lastSignInAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "iam_staff_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "iam_staff_sign_in_codes" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "iam_staff_sign_in_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "iam_staff_refresh_tokens" (
    "id" UUID NOT NULL,
    "staffId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "iam_staff_refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "iam_staff_accounts_email_key" ON "iam_staff_accounts"("email");

-- CreateIndex
CREATE INDEX "iam_staff_sign_in_codes_email_idx" ON "iam_staff_sign_in_codes"("email");

-- CreateIndex
CREATE UNIQUE INDEX "iam_staff_refresh_tokens_tokenHash_key" ON "iam_staff_refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "iam_staff_refresh_tokens_staffId_idx" ON "iam_staff_refresh_tokens"("staffId");

-- AddForeignKey
ALTER TABLE "iam_staff_refresh_tokens" ADD CONSTRAINT "iam_staff_refresh_tokens_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "iam_staff_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

