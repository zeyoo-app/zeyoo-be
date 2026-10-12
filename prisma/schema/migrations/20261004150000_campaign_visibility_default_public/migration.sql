-- Campaigns are discoverable by default; invite-only is an explicit choice.
ALTER TABLE "campaigns" ALTER COLUMN "visibility" SET DEFAULT 'PUBLIC';
