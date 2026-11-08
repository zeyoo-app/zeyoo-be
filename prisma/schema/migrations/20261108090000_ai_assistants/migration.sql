-- AI assistants: richer request log and the staff-chosen provider/model.
CREATE TYPE "AiRequestStatus" AS ENUM ('SUCCEEDED', 'FAILED', 'CANCELLED');

ALTER TABLE "ai_requests"
    ADD COLUMN "promptVersion" TEXT,
    ADD COLUMN "provider" TEXT,
    ADD COLUMN "model" TEXT,
    ADD COLUMN "status" "AiRequestStatus" NOT NULL DEFAULT 'SUCCEEDED',
    ADD COLUMN "errorCode" TEXT,
    ADD COLUMN "inputTokens" INTEGER,
    ADD COLUMN "outputTokens" INTEGER,
    ADD COLUMN "durationMs" INTEGER,
    ALTER COLUMN "response" DROP NOT NULL;

CREATE INDEX "ai_requests_createdAt_idx" ON "ai_requests"("createdAt");

CREATE TABLE "ai_settings" (
    "key" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "updatedByStaffId" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_settings_pkey" PRIMARY KEY ("key")
);
