-- CreateTable
CREATE TABLE "notification_device_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_device_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_device_tokens_token_key" ON "notification_device_tokens"("token");

-- CreateIndex
CREATE INDEX "notification_device_tokens_userId_idx" ON "notification_device_tokens"("userId");
