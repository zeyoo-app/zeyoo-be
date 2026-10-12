-- CreateTable
CREATE TABLE "creator_earnings" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "creatorUserId" UUID NOT NULL,
    "accruedAmount" INTEGER NOT NULL DEFAULT 0,
    "currencyCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "creator_earnings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "creator_earnings_creatorUserId_idx" ON "creator_earnings"("creatorUserId");

-- CreateIndex
CREATE UNIQUE INDEX "creator_earnings_campaignId_creatorUserId_key" ON "creator_earnings"("campaignId", "creatorUserId");
