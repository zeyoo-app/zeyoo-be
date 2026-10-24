-- AlterTable
ALTER TABLE "disputes"
  ADD COLUMN "responseDueAt" TIMESTAMP(3),
  ADD COLUMN "respondedAt" TIMESTAMP(3),
  ADD COLUMN "escalatedAt" TIMESTAMP(3);
