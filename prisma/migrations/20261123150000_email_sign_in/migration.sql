-- CreateEnum
CREATE TYPE "EmailPurpose" AS ENUM ('SIGN_IN', 'VERIFY', 'RESET');

-- AlterTable
ALTER TABLE "PlatformUser" ADD COLUMN     "sessionVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "EmailChallenge" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "purpose" "EmailPurpose" NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformPasswordReset" (
    "id" TEXT NOT NULL,
    "platformUserId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformPasswordReset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailChallenge_tenantId_email_purpose_createdAt_idx" ON "EmailChallenge"("tenantId", "email", "purpose", "createdAt");

-- CreateIndex
CREATE INDEX "EmailChallenge_tenantId_userId_purpose_createdAt_idx" ON "EmailChallenge"("tenantId", "userId", "purpose", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformPasswordReset_tokenHash_key" ON "PlatformPasswordReset"("tokenHash");

-- CreateIndex
CREATE INDEX "PlatformPasswordReset_platformUserId_createdAt_idx" ON "PlatformPasswordReset"("platformUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "EmailChallenge" ADD CONSTRAINT "EmailChallenge_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailChallenge" ADD CONSTRAINT "EmailChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformPasswordReset" ADD CONSTRAINT "PlatformPasswordReset_platformUserId_fkey" FOREIGN KEY ("platformUserId") REFERENCES "PlatformUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Codes and reset links belong to one business, like OtpChallenge.
ALTER TABLE "EmailChallenge" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmailChallenge" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "EmailChallenge" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');

-- One verified owner per address in a business, so an email code or reset link
-- can only ever mean one login. Unverified addresses (typed by the office) don't count.
CREATE UNIQUE INDEX "User_verified_email_once" ON "User"("tenantId", lower("email"))
  WHERE "emailVerifiedAt" IS NOT NULL AND "email" IS NOT NULL;
