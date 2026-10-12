-- A campaign can target several platforms, and cap what one creator may earn.
ALTER TABLE "campaigns" ADD COLUMN "platforms" "SocialPlatform"[] NOT NULL DEFAULT ARRAY[]::"SocialPlatform"[];
ALTER TABLE "campaigns" ADD COLUMN "maxRewardPerCreatorAmount" INTEGER;

-- Existing campaigns keep their single platform as the full set.
UPDATE "campaigns" SET "platforms" = ARRAY["platform"];
