-- Google sign-in links, two-step sign-in (authenticator app + recovery codes) for business and console users,
-- and single-use Google hand-back tickets (platform table, no row-level security).
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "googleEmail" TEXT,
ADD COLUMN     "googleSub" TEXT,
ADD COLUMN     "recoveryCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "totpEnabledAt" TIMESTAMP(3),
ADD COLUMN     "totpLastStep" INTEGER,
ADD COLUMN     "totpSecret" TEXT;

-- AlterTable
ALTER TABLE "PlatformUser" ADD COLUMN     "googleEmail" TEXT,
ADD COLUMN     "googleSub" TEXT,
ADD COLUMN     "recoveryCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "totpEnabledAt" TIMESTAMP(3),
ADD COLUMN     "totpLastStep" INTEGER,
ADD COLUMN     "totpSecret" TEXT;

-- CreateTable
CREATE TABLE "AuthTicketUse" (
    "id" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthTicketUse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuthTicketUse_usedAt_idx" ON "AuthTicketUse"("usedAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_tenantId_googleSub_key" ON "User"("tenantId", "googleSub");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformUser_googleSub_key" ON "PlatformUser"("googleSub");

