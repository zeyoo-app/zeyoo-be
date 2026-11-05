-- Brand wallet: a prepaid USD balance brands top up by card and spend on campaigns.
ALTER TYPE "LedgerAccountOwnerType" ADD VALUE 'ORGANIZATION_WALLET';

ALTER TYPE "LedgerTransactionType" ADD VALUE 'WALLET_TOPUP';
ALTER TYPE "LedgerTransactionType" ADD VALUE 'WALLET_FUNDING';
ALTER TYPE "LedgerTransactionType" ADD VALUE 'WALLET_RETURN';

-- Card payments into a wallet, tracked until Stripe confirms them.
CREATE TABLE "wallet_top_ups" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "status" "FundingStatus" NOT NULL DEFAULT 'PENDING',
    "stripeCheckoutId" TEXT NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallet_top_ups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "wallet_top_ups_stripeCheckoutId_key" ON "wallet_top_ups"("stripeCheckoutId");
CREATE INDEX "wallet_top_ups_organizationId_idx" ON "wallet_top_ups"("organizationId");
