-- AlterTable
ALTER TABLE "notification_preferences"
  ADD COLUMN "submissionUpdates" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "payoutUpdates" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "campaignInvites" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "productNews" BOOLEAN NOT NULL DEFAULT false;
