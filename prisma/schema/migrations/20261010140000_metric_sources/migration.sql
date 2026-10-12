-- CreateEnum
CREATE TYPE "MetricSource" AS ENUM ('MANUAL', 'PLATFORM_API');

-- AlterTable
ALTER TABLE "social_oauth_tokens" ADD COLUMN "externalAccountId" TEXT;

-- AlterTable
ALTER TABLE "social_metric_snapshots" ADD COLUMN "source" "MetricSource" NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "social_metric_snapshots" ADD COLUMN "submissionId" UUID;

-- CreateIndex
CREATE INDEX "social_metric_snapshots_submissionId_idx" ON "social_metric_snapshots"("submissionId");
