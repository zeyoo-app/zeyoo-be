CREATE TYPE "CampaignContentType" AS ENUM ('UGC', 'CLIPPING');

ALTER TABLE "campaigns"
ADD COLUMN "contentType" "CampaignContentType" NOT NULL DEFAULT 'UGC',
ADD COLUMN "coverImageUrl" TEXT;
