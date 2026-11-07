-- A revision can now point at one published post per campaign platform, so views
-- are tracked and paid per post instead of from a single link.
CREATE TABLE "submission_posts" (
    "id" UUID NOT NULL,
    "revisionId" UUID NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submission_posts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "submission_posts_revisionId_platform_key" ON "submission_posts"("revisionId", "platform");

ALTER TABLE "submission_posts" ADD CONSTRAINT "submission_posts_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "submission_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every existing link revision becomes a one-post revision. The platform is read from
-- the link's host, as the views sync does, falling back to the campaign's main platform.
INSERT INTO "submission_posts" ("id", "revisionId", "platform", "url", "createdAt")
SELECT
    gen_random_uuid(),
    r."id",
    CASE
        WHEN substring(r."contentUrl" from '^https?://([^/?#]+)') ~* '(^|\.)tiktok\.com$' THEN 'TIKTOK'::"SocialPlatform"
        WHEN substring(r."contentUrl" from '^https?://([^/?#]+)') ~* '(^|\.)instagram\.com$' THEN 'INSTAGRAM'::"SocialPlatform"
        WHEN substring(r."contentUrl" from '^https?://([^/?#]+)') ~* '(^|\.)(youtube\.com|youtu\.be)$' THEN 'YOUTUBE'::"SocialPlatform"
        WHEN substring(r."contentUrl" from '^https?://([^/?#]+)') ~* '(^|\.)(x|twitter)\.com$' THEN 'X'::"SocialPlatform"
        WHEN substring(r."contentUrl" from '^https?://([^/?#]+)') ~* '(^|\.)snapchat\.com$' THEN 'SNAPCHAT'::"SocialPlatform"
        ELSE c."platform"
    END,
    r."contentUrl",
    r."createdAt"
FROM "submission_revisions" r
JOIN "submissions" s ON s."id" = r."submissionId"
JOIN "campaigns" c ON c."id" = s."campaignId"
WHERE r."contentType" = 'LINK';
