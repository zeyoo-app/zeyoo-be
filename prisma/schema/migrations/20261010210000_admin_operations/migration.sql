-- AlterEnum
ALTER TYPE "LedgerTransactionType" ADD VALUE 'CAMPAIGN_REFUND';

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- AlterTable
ALTER TABLE "creator_profiles"
  ADD COLUMN "verificationNote" TEXT,
  ADD COLUMN "verificationReviewedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "campaign_refunds" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "fundingId" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "stripeRefundId" TEXT,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "campaign_refunds_campaignId_idx" ON "campaign_refunds"("campaignId");

-- CreateIndex
CREATE INDEX "campaign_refunds_fundingId_idx" ON "campaign_refunds"("fundingId");
