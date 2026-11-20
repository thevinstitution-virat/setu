-- Phase 13 (A1): orders sent as messages, read into lines for the shop to confirm.
-- CreateEnum
CREATE TYPE "OrderDraftStatus" AS ENUM ('READING', 'OPEN', 'USED', 'EXPIRED');

-- CreateTable
CREATE TABLE "OrderDraft" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "retailerId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'whatsapp',
    "text" TEXT NOT NULL,
    "lines" JSONB NOT NULL DEFAULT '[]',
    "source" TEXT,
    "status" "OrderDraftStatus" NOT NULL DEFAULT 'READING',
    "messageId" TEXT,
    "orderId" TEXT,
    "reply" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderDraft_tenantId_retailerId_status_idx" ON "OrderDraft"("tenantId", "retailerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OrderDraft_tenantId_messageId_key" ON "OrderDraft"("tenantId", "messageId");

-- AddForeignKey
ALTER TABLE "OrderDraft" ADD CONSTRAINT "OrderDraft_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderDraft" ADD CONSTRAINT "OrderDraft_retailerId_fkey" FOREIGN KEY ("retailerId") REFERENCES "RetailerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A used draft names the order placed from it.
ALTER TABLE "OrderDraft" ADD CONSTRAINT "OrderDraft_used_check" CHECK ("status" <> 'USED' OR "orderId" IS NOT NULL);

-- Row-level security
ALTER TABLE "OrderDraft" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrderDraft" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "OrderDraft" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
