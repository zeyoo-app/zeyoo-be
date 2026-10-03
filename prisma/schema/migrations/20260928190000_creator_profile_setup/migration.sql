ALTER TABLE "creator_profiles"
ADD COLUMN "username" TEXT,
ADD COLUMN "avatarUrl" TEXT;

UPDATE "creator_profiles"
SET "username" = LOWER(REGEXP_REPLACE("displayName", '[^a-zA-Z0-9._]', '', 'g')) || '_' || LEFT("id"::text, 6)
WHERE "username" IS NULL;

ALTER TABLE "creator_profiles"
ALTER COLUMN "username" SET NOT NULL;

CREATE UNIQUE INDEX "creator_profiles_username_key" ON "creator_profiles"("username");

ALTER TYPE "SocialPlatform" ADD VALUE IF NOT EXISTS 'SNAPCHAT';
