-- Allow accounts to be created from a phone number alone. `email` stays unique
-- but becomes nullable, so the index is left in place; Postgres already permits
-- any number of NULLs under a unique index.
ALTER TABLE "iam_users"
ALTER COLUMN "email" DROP NOT NULL;

ALTER TABLE "iam_users"
ADD COLUMN "phone" TEXT,
ADD COLUMN "phoneVerifiedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "iam_users_phone_key" ON "iam_users"("phone");

-- CreateTable
CREATE TABLE "iam_phone_verification_codes" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "iam_phone_verification_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "iam_phone_verification_codes_phone_idx" ON "iam_phone_verification_codes"("phone");
