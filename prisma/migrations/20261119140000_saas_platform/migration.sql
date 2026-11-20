-- CreateEnum
CREATE TYPE "SubStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PlatformInvoiceStatus" AS ENUM ('ISSUED', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('OWNER', 'SUPPORT');

-- CreateEnum
CREATE TYPE "SupportMode" AS ENUM ('READ', 'WRITE');

-- CreateEnum
CREATE TYPE "ExportStatus" AS ENUM ('QUEUED', 'RUNNING', 'READY', 'FAILED', 'EXPIRED');

-- AlterEnum
ALTER TYPE "TenantStatus" ADD VALUE 'CLOSED';

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "deleteAfter" TIMESTAMP(3),
ADD COLUMN     "deleteRequestedAt" TIMESTAMP(3),
ADD COLUMN     "onboarding" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "overrides" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "suspendReason" TEXT,
ADD COLUMN     "suspendedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TenantDomain" ADD COLUMN     "checkedAt" TIMESTAMP(3),
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "tlsStatus" TEXT,
ADD COLUMN     "token" TEXT NOT NULL DEFAULT md5(random()::text || clock_timestamp()::text);
ALTER TABLE "TenantDomain" ALTER COLUMN "token" DROP DEFAULT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isSupport" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Plan" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "basePaise" INTEGER NOT NULL DEFAULT 0,
    "seatPaise" INTEGER NOT NULL DEFAULT 0,
    "retailerPaise" INTEGER NOT NULL DEFAULT 0,
    "aiCredits" INTEGER NOT NULL DEFAULT 0,
    "aiCreditPaise" INTEGER NOT NULL DEFAULT 0,
    "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "limits" JSONB NOT NULL DEFAULT '{}',
    "trialDays" INTEGER NOT NULL DEFAULT 14,
    "public" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "planCode" TEXT NOT NULL,
    "status" "SubStatus" NOT NULL DEFAULT 'TRIAL',
    "trialEndsAt" TIMESTAMP(3),
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "nextPlanCode" TEXT,
    "billingEmail" TEXT,
    "cancelAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageCounter" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "period" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "costPaise" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformInvoice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "number" TEXT NOT NULL,
    "fy" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "lines" JSONB NOT NULL,
    "billTo" JSONB NOT NULL,
    "seller" JSONB NOT NULL,
    "interState" BOOLEAN NOT NULL,
    "taxable" INTEGER NOT NULL,
    "cgst" INTEGER NOT NULL DEFAULT 0,
    "sgst" INTEGER NOT NULL DEFAULT 0,
    "igst" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "status" "PlatformInvoiceStatus" NOT NULL DEFAULT 'ISSUED',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "paidRef" TEXT,
    "paidVia" TEXT,
    "voidReason" TEXT,
    "payLinkId" TEXT,
    "payUrl" TEXT,
    "remindersSent" INTEGER NOT NULL DEFAULT 0,
    "lastReminderAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformCounter" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PlatformCounter_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "PlatformUser" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "PlatformRole" NOT NULL DEFAULT 'SUPPORT',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportSession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "platformUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "mode" "SupportMode" NOT NULL DEFAULT 'READ',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "SupportSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformAudit" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "tenantId" TEXT,
    "detail" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformAnnouncement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'info',
    "audience" TEXT NOT NULL DEFAULT 'ADMINS',
    "tenantIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformAnnouncement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantExport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "status" "ExportStatus" NOT NULL DEFAULT 'QUEUED',
    "fileKey" TEXT,
    "bytes" INTEGER,
    "rows" INTEGER,
    "error" TEXT,
    "requestedBy" TEXT,
    "forDeletion" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "TenantExport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignupChallenge" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "ip" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignupChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_tenantId_key" ON "Subscription"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "UsageCounter_tenantId_period_metric_key" ON "UsageCounter"("tenantId", "period", "metric");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformInvoice_number_key" ON "PlatformInvoice"("number");

-- CreateIndex
CREATE INDEX "PlatformInvoice_status_dueAt_idx" ON "PlatformInvoice"("status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformInvoice_tenantId_periodStart_key" ON "PlatformInvoice"("tenantId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformUser_email_key" ON "PlatformUser"("email");

-- CreateIndex
CREATE INDEX "SupportSession_tenantId_startedAt_idx" ON "SupportSession"("tenantId", "startedAt");

-- CreateIndex
CREATE INDEX "PlatformAudit_tenantId_createdAt_idx" ON "PlatformAudit"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "PlatformAudit_createdAt_idx" ON "PlatformAudit"("createdAt");

-- CreateIndex
CREATE INDEX "PlatformAnnouncement_startsAt_idx" ON "PlatformAnnouncement"("startsAt");

-- CreateIndex
CREATE INDEX "TenantExport_tenantId_createdAt_idx" ON "TenantExport"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "SignupChallenge_phone_createdAt_idx" ON "SignupChallenge"("phone", "createdAt");

-- CreateIndex
CREATE INDEX "SignupChallenge_ip_createdAt_idx" ON "SignupChallenge"("ip", "createdAt");

-- CreateIndex
CREATE INDEX "TenantDomain_tenantId_idx" ON "TenantDomain"("tenantId");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planCode_fkey" FOREIGN KEY ("planCode") REFERENCES "Plan"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageCounter" ADD CONSTRAINT "UsageCounter_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformInvoice" ADD CONSTRAINT "PlatformInvoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportSession" ADD CONSTRAINT "SupportSession_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportSession" ADD CONSTRAINT "SupportSession_platformUserId_fkey" FOREIGN KEY ("platformUserId") REFERENCES "PlatformUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformAudit" ADD CONSTRAINT "PlatformAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "PlatformUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformAnnouncement" ADD CONSTRAINT "PlatformAnnouncement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "PlatformUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantExport" ADD CONSTRAINT "TenantExport_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───────────── Phase 9 security: checks, row-level security, purge ─────────────

ALTER TABLE "Plan" ADD CONSTRAINT "Plan_prices_valid" CHECK ("basePaise" >= 0 AND "seatPaise" >= 0 AND "retailerPaise" >= 0 AND "aiCredits" >= 0 AND "aiCreditPaise" >= 0 AND "trialDays" BETWEEN 0 AND 90);
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_period_valid" CHECK ("periodEnd" > "periodStart");
ALTER TABLE "UsageCounter" ADD CONSTRAINT "UsageCounter_valid" CHECK ("value" >= 0 AND "costPaise" >= 0 AND "period" ~ '^[0-9]{4}-[0-9]{2}$');
ALTER TABLE "PlatformInvoice" ADD CONSTRAINT "PlatformInvoice_amounts_valid" CHECK ("taxable" >= 0 AND "cgst" >= 0 AND "sgst" >= 0 AND "igst" >= 0 AND "total" = "taxable" + "cgst" + "sgst" + "igst" AND ("interState" = ("cgst" = 0 AND "sgst" = 0) OR "taxable" = 0));
ALTER TABLE "PlatformInvoice" ADD CONSTRAINT "PlatformInvoice_paid_valid" CHECK (("status" = 'PAID') = ("paidAt" IS NOT NULL));
ALTER TABLE "SupportSession" ADD CONSTRAINT "SupportSession_window_valid" CHECK ("expiresAt" > "startedAt" AND "expiresAt" <= "startedAt" + interval '4 hours');
ALTER TABLE "PlatformCounter" ADD CONSTRAINT "PlatformCounter_positive" CHECK ("value" >= 0);

-- Tenant-owned platform rows: a tenant reads only its own; the platform uses app.bypass_rls.
ALTER TABLE "Subscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Subscription" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Subscription" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "UsageCounter" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UsageCounter" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "UsageCounter" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "PlatformInvoice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PlatformInvoice" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PlatformInvoice" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "SupportSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupportSession" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SupportSession" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "TenantExport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantExport" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TenantExport" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');

-- Our own invoices: amounts, parties and numbers never change after issue.
CREATE OR REPLACE FUNCTION platform_invoice_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Platform invoices cannot be deleted; void them instead';
  END IF;
  IF NEW."tenantId" IS DISTINCT FROM OLD."tenantId"
     OR NEW."number" IS DISTINCT FROM OLD."number"
     OR NEW."fy" IS DISTINCT FROM OLD."fy"
     OR NEW."periodStart" IS DISTINCT FROM OLD."periodStart"
     OR NEW."periodEnd" IS DISTINCT FROM OLD."periodEnd"
     OR NEW."lines" IS DISTINCT FROM OLD."lines"
     OR NEW."billTo" IS DISTINCT FROM OLD."billTo"
     OR NEW."seller" IS DISTINCT FROM OLD."seller"
     OR NEW."interState" IS DISTINCT FROM OLD."interState"
     OR NEW."taxable" IS DISTINCT FROM OLD."taxable"
     OR NEW."cgst" IS DISTINCT FROM OLD."cgst"
     OR NEW."sgst" IS DISTINCT FROM OLD."sgst"
     OR NEW."igst" IS DISTINCT FROM OLD."igst"
     OR NEW."total" IS DISTINCT FROM OLD."total"
     OR NEW."issuedAt" IS DISTINCT FROM OLD."issuedAt"
     OR (OLD."status" <> 'ISSUED' AND NEW."status" IS DISTINCT FROM OLD."status")
  THEN
    RAISE EXCEPTION 'An issued platform invoice cannot be changed';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER platform_invoice_guard BEFORE UPDATE OR DELETE ON "PlatformInvoice"
  FOR EACH ROW EXECUTE FUNCTION platform_invoice_guard();

-- DPDP deletion: lib/tenant-purge.ts sets app.purge_tenant = <tenant id> inside
-- one transaction and deletes every row of that tenant. Only then may the
-- append-only tables and immutable documents of THAT tenant be deleted.
CREATE POLICY purge_delete ON "AuditLog" FOR DELETE USING ("tenantId" = current_setting('app.purge_tenant', true));
CREATE POLICY purge_delete ON "JournalEntry" FOR DELETE USING ("tenantId" = current_setting('app.purge_tenant', true));
CREATE POLICY purge_delete ON "LedgerLine" FOR DELETE USING ("tenantId" = current_setting('app.purge_tenant', true));

CREATE OR REPLACE FUNCTION purging(tid text) RETURNS boolean AS $$
  SELECT coalesce(current_setting('app.purge_tenant', true), '') <> '' AND current_setting('app.purge_tenant', true) = tid;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION invoice_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF purging(OLD."tenantId") THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Invoices cannot be deleted; issue a credit note instead';
  END IF;
  IF NEW."tenantId" IS DISTINCT FROM OLD."tenantId"
     OR NEW."type" IS DISTINCT FROM OLD."type"
     OR NEW."number" IS DISTINCT FROM OLD."number"
     OR NEW."fy" IS DISTINCT FROM OLD."fy"
     OR NEW."date" IS DISTINCT FROM OLD."date"
     OR NEW."orderId" IS DISTINCT FROM OLD."orderId"
     OR NEW."retailerId" IS DISTINCT FROM OLD."retailerId"
     OR NEW."originalId" IS DISTINCT FROM OLD."originalId"
     OR NEW."seller" IS DISTINCT FROM OLD."seller"
     OR NEW."buyer" IS DISTINCT FROM OLD."buyer"
     OR NEW."b2b" IS DISTINCT FROM OLD."b2b"
     OR NEW."placeOfSupply" IS DISTINCT FROM OLD."placeOfSupply"
     OR NEW."interState" IS DISTINCT FROM OLD."interState"
     OR NEW."taxable" IS DISTINCT FROM OLD."taxable"
     OR NEW."cgst" IS DISTINCT FROM OLD."cgst"
     OR NEW."sgst" IS DISTINCT FROM OLD."sgst"
     OR NEW."igst" IS DISTINCT FROM OLD."igst"
     OR NEW."total" IS DISTINCT FROM OLD."total"
     OR (OLD."entryId" IS NOT NULL AND NEW."entryId" IS DISTINCT FROM OLD."entryId")
  THEN
    IF purging(OLD."tenantId") THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'An issued invoice cannot be changed; issue a credit or debit note instead';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION invoice_line_guard() RETURNS trigger AS $$
BEGIN
  IF purging(OLD."tenantId") THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Invoice lines cannot be changed or deleted';
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION returnable_move_guard() RETURNS trigger AS $$
BEGIN
  IF purging(OLD."tenantId") THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Returnable moves are append-only';
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION stock_move_guard() RETURNS trigger AS $$
BEGIN
  IF purging(OLD."tenantId") THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Stock moves are append-only';
END $$ LANGUAGE plpgsql;
