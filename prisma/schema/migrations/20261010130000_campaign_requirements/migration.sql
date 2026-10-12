-- Structured requirements, previously dropped or folded into free text.
ALTER TABLE "campaigns" ADD COLUMN "hashtags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "campaigns" ADD COLUMN "mentions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "campaigns" ADD COLUMN "referenceMaterials" JSONB NOT NULL DEFAULT '[]';
