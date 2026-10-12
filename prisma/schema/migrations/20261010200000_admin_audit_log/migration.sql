-- CreateTable
CREATE TABLE "admin_audit_log" (
    "id" UUID NOT NULL,
    "adminUserId" UUID NOT NULL,
    "method" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "params" JSONB,
    "body" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_audit_log_createdAt_idx" ON "admin_audit_log"("createdAt");

-- CreateIndex
CREATE INDEX "admin_audit_log_adminUserId_idx" ON "admin_audit_log"("adminUserId");
