-- Phase 15: password sign-in tries (platform table, like PlatformUser; no row-level security).
-- CreateTable
CREATE TABLE "AuthAttempt" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "ip" TEXT,
    "ok" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuthAttempt_scope_key_createdAt_idx" ON "AuthAttempt"("scope", "key", "createdAt");

-- CreateIndex
CREATE INDEX "AuthAttempt_ip_createdAt_idx" ON "AuthAttempt"("ip", "createdAt");
