-- CreateEnum
CREATE TYPE "IntentKind" AS ENUM ('LINK', 'QR');

-- CreateEnum
CREATE TYPE "IntentStatus" AS ENUM ('CREATED', 'PARTIAL', 'PAID', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BankLineStatus" AS ENUM ('UNMATCHED', 'SUGGESTED', 'MATCHED', 'IGNORED');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'DEAD');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AccountType" ADD VALUE 'GATEWAY_CLEARING';
ALTER TYPE "AccountType" ADD VALUE 'GATEWAY_FEES';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EntryKind" ADD VALUE 'BANK_MATCH';
ALTER TYPE "EntryKind" ADD VALUE 'GATEWAY_SETTLEMENT';

-- AlterEnum
ALTER TYPE "PayMethod" ADD VALUE 'ONLINE';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "gatewayPaymentId" TEXT,
ADD COLUMN     "intentId" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "RetailerProfile" ADD COLUMN     "locationSource" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "PaymentIntent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "kind" "IntentKind" NOT NULL,
    "provider" TEXT NOT NULL,
    "retailerId" TEXT NOT NULL,
    "purpose" "PayPurpose" NOT NULL DEFAULT 'DUES',
    "amount" INTEGER NOT NULL,
    "paidAmount" INTEGER NOT NULL DEFAULT 0,
    "orderId" TEXT,
    "providerRef" TEXT,
    "shortUrl" TEXT,
    "imageUrl" TEXT,
    "status" "IntentStatus" NOT NULL DEFAULT 'CREATED',
    "error" TEXT,
    "note" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GatewayEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GatewayEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GatewaySettlement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "provider" TEXT NOT NULL,
    "providerRef" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "fees" INTEGER NOT NULL,
    "tax" INTEGER NOT NULL,
    "utr" TEXT,
    "settledAt" TIMESTAMP(3) NOT NULL,
    "entryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GatewaySettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankStatement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "fileName" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "fromDate" TIMESTAMP(3),
    "toDate" TIMESTAMP(3),
    "lineCount" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "statementId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "narration" TEXT NOT NULL,
    "reference" TEXT,
    "debit" INTEGER NOT NULL DEFAULT 0,
    "credit" INTEGER NOT NULL DEFAULT 0,
    "balance" INTEGER,
    "fingerprint" TEXT NOT NULL,
    "status" "BankLineStatus" NOT NULL DEFAULT 'UNMATCHED',
    "matchKind" TEXT,
    "matchRef" TEXT,
    "suggestions" JSONB,
    "entryId" TEXT,
    "note" TEXT,
    "matchedById" TEXT,
    "matchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "scopes" TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "lastUsedIp" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEndpoint" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "url" TEXT NOT NULL,
    "description" TEXT,
    "events" TEXT[],
    "secret" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "failStreak" INTEGER NOT NULL DEFAULT 0,
    "disabledReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "endpointId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastCode" INTEGER,
    "lastError" TEXT,
    "durationMs" INTEGER,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeoCache" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "provider" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeoCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentIntent_tenantId_status_createdAt_idx" ON "PaymentIntent"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentIntent_tenantId_retailerId_createdAt_idx" ON "PaymentIntent"("tenantId", "retailerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentIntent_tenantId_providerRef_key" ON "PaymentIntent"("tenantId", "providerRef");

-- CreateIndex
CREATE INDEX "GatewayEvent_tenantId_receivedAt_idx" ON "GatewayEvent"("tenantId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "GatewayEvent_tenantId_provider_eventId_key" ON "GatewayEvent"("tenantId", "provider", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "GatewaySettlement_tenantId_providerRef_key" ON "GatewaySettlement"("tenantId", "providerRef");

-- CreateIndex
CREATE INDEX "BankStatement_tenantId_createdAt_idx" ON "BankStatement"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "BankLine_tenantId_status_date_idx" ON "BankLine"("tenantId", "status", "date");

-- CreateIndex
CREATE INDEX "BankLine_tenantId_statementId_idx" ON "BankLine"("tenantId", "statementId");

-- CreateIndex
CREATE UNIQUE INDEX "BankLine_tenantId_fingerprint_key" ON "BankLine"("tenantId", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "BankLine_tenantId_matchKind_matchRef_key" ON "BankLine"("tenantId", "matchKind", "matchRef");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_tenantId_prefix_key" ON "ApiKey"("tenantId", "prefix");

-- CreateIndex
CREATE INDEX "WebhookEndpoint_tenantId_active_idx" ON "WebhookEndpoint"("tenantId", "active");

-- CreateIndex
CREATE INDEX "WebhookDelivery_tenantId_status_nextAttemptAt_idx" ON "WebhookDelivery"("tenantId", "status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_tenantId_endpointId_createdAt_idx" ON "WebhookDelivery"("tenantId", "endpointId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDelivery_tenantId_endpointId_eventKey_key" ON "WebhookDelivery"("tenantId", "endpointId", "eventKey");

-- CreateIndex
CREATE UNIQUE INDEX "GeoCache_tenantId_kind_key_key" ON "GeoCache"("tenantId", "kind", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_tenantId_gatewayPaymentId_key" ON "Payment"("tenantId", "gatewayPaymentId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "PaymentIntent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_retailerId_fkey" FOREIGN KEY ("retailerId") REFERENCES "RetailerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GatewayEvent" ADD CONSTRAINT "GatewayEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GatewaySettlement" ADD CONSTRAINT "GatewaySettlement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatement" ADD CONSTRAINT "BankStatement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatement" ADD CONSTRAINT "BankStatement_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankLine" ADD CONSTRAINT "BankLine_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankLine" ADD CONSTRAINT "BankLine_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "BankStatement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "WebhookEndpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoCache" ADD CONSTRAINT "GeoCache_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Row-level security: every new table belongs to one business.
ALTER TABLE "PaymentIntent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentIntent" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PaymentIntent" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "GatewayEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GatewayEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "GatewayEvent" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "GatewaySettlement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GatewaySettlement" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "GatewaySettlement" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "BankStatement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BankStatement" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "BankStatement" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "BankLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BankLine" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "BankLine" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "ApiKey" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ApiKey" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ApiKey" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "WebhookEndpoint" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WebhookEndpoint" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WebhookEndpoint" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "WebhookDelivery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WebhookDelivery" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WebhookDelivery" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "GeoCache" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GeoCache" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "GeoCache" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');

-- Rules the database itself keeps.
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_amounts_check" CHECK ("amount" > 0 AND "paidAmount" >= 0);
ALTER TABLE "BankLine" ADD CONSTRAINT "BankLine_one_side_check" CHECK ("debit" >= 0 AND "credit" >= 0 AND ("debit" = 0) <> ("credit" = 0));
ALTER TABLE "GatewaySettlement" ADD CONSTRAINT "GatewaySettlement_amounts_check" CHECK ("amount" >= 0 AND "fees" >= 0 AND "tax" >= 0 AND "tax" <= "fees");
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_attempts_check" CHECK ("attempts" >= 0 AND "attempts" <= 20);
ALTER TABLE "RetailerProfile" ADD CONSTRAINT "RetailerProfile_location_source_check" CHECK ("locationSource" IS NULL OR "locationSource" IN ('gps', 'address', 'manual'));
