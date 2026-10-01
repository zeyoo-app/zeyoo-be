-- CreateTable
CREATE TABLE "payout_accounts" (
    "id" UUID NOT NULL,
    "creatorUserId" UUID NOT NULL,
    "stripeAccountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payout_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_payment_methods" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "brand" TEXT,
    "last4" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payout_accounts_creatorUserId_key" ON "payout_accounts"("creatorUserId");
CREATE UNIQUE INDEX "payout_accounts_stripeAccountId_key" ON "payout_accounts"("stripeAccountId");
CREATE UNIQUE INDEX "billing_payment_methods_organizationId_key" ON "billing_payment_methods"("organizationId");
