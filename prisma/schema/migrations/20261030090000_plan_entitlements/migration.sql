-- Plan entitlements: what each subscription tier allows, enforced by the product.
ALTER TABLE "billing_plans" ADD COLUMN "priceMinorSar" INTEGER;
ALTER TABLE "billing_plans" ADD COLUMN "maxActiveCampaigns" INTEGER;
ALTER TABLE "billing_plans" ADD COLUMN "platformFeeBps" INTEGER NOT NULL DEFAULT 1000;
ALTER TABLE "billing_plans" ADD COLUMN "allowsPrivateCampaigns" BOOLEAN NOT NULL DEFAULT false;

-- The platform fee paid on top of a campaign's budget.
ALTER TABLE "campaign_fundings" ADD COLUMN "feeAmount" INTEGER NOT NULL DEFAULT 0;
