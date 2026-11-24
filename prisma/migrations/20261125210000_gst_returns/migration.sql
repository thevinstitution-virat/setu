-- AlterEnum
ALTER TYPE "EntryKind" ADD VALUE 'GST_PAYMENT';

-- CreateTable
CREATE TABLE "GstSettlement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "period" TEXT NOT NULL,
    "liabIgst" INTEGER NOT NULL,
    "liabCgst" INTEGER NOT NULL,
    "liabSgst" INTEGER NOT NULL,
    "rcmIgst" INTEGER NOT NULL,
    "rcmCgst" INTEGER NOT NULL,
    "rcmSgst" INTEGER NOT NULL,
    "openIgst" INTEGER NOT NULL,
    "openCgst" INTEGER NOT NULL,
    "openSgst" INTEGER NOT NULL,
    "itcIgst" INTEGER NOT NULL,
    "itcCgst" INTEGER NOT NULL,
    "itcSgst" INTEGER NOT NULL,
    "useIgstIgst" INTEGER NOT NULL,
    "useIgstCgst" INTEGER NOT NULL,
    "useIgstSgst" INTEGER NOT NULL,
    "useCgstCgst" INTEGER NOT NULL,
    "useCgstIgst" INTEGER NOT NULL,
    "useSgstSgst" INTEGER NOT NULL,
    "useSgstIgst" INTEGER NOT NULL,
    "cashIgst" INTEGER NOT NULL,
    "cashCgst" INTEGER NOT NULL,
    "cashSgst" INTEGER NOT NULL,
    "closeIgst" INTEGER NOT NULL,
    "closeCgst" INTEGER NOT NULL,
    "closeSgst" INTEGER NOT NULL,
    "bankAccountId" TEXT,
    "challan" TEXT,
    "paidOn" DATE NOT NULL,
    "arn" TEXT,
    "working" JSONB NOT NULL,
    "entryId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GstSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Gstr2bImport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "period" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "gstin" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Gstr2bImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Gstr2bRow" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "importId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "gstin" TEXT NOT NULL,
    "name" TEXT,
    "number" TEXT NOT NULL,
    "numberKey" TEXT NOT NULL,
    "date" DATE,
    "taxable" INTEGER NOT NULL,
    "igst" INTEGER NOT NULL,
    "cgst" INTEGER NOT NULL,
    "sgst" INTEGER NOT NULL,
    "cess" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "reverseCharge" BOOLEAN NOT NULL DEFAULT false,
    "itcAvailable" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Gstr2bRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GstSettlement_entryId_key" ON "GstSettlement"("entryId");

-- CreateIndex
CREATE INDEX "GstSettlement_tenantId_period_idx" ON "GstSettlement"("tenantId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "Gstr2bImport_tenantId_period_key" ON "Gstr2bImport"("tenantId", "period");

-- CreateIndex
CREATE INDEX "Gstr2bRow_tenantId_gstin_numberKey_idx" ON "Gstr2bRow"("tenantId", "gstin", "numberKey");

-- CreateIndex
CREATE INDEX "Gstr2bRow_importId_idx" ON "Gstr2bRow"("importId");

-- AddForeignKey
ALTER TABLE "GstSettlement" ADD CONSTRAINT "GstSettlement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GstSettlement" ADD CONSTRAINT "GstSettlement_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gstr2bImport" ADD CONSTRAINT "Gstr2bImport_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gstr2bRow" ADD CONSTRAINT "Gstr2bRow_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gstr2bRow" ADD CONSTRAINT "Gstr2bRow_importId_fkey" FOREIGN KEY ("importId") REFERENCES "Gstr2bImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One live settlement per month.
CREATE UNIQUE INDEX "GstSettlement_live_period" ON "GstSettlement"("tenantId", "period") WHERE "cancelledAt" IS NULL;

-- Row-level security.
ALTER TABLE "GstSettlement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GstSettlement" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "GstSettlement" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "Gstr2bImport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Gstr2bImport" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Gstr2bImport" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "Gstr2bRow" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Gstr2bRow" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Gstr2bRow" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');

-- Checks.
ALTER TABLE "GstSettlement" ADD CONSTRAINT "GstSettlement_period" CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
ALTER TABLE "GstSettlement" ADD CONSTRAINT "GstSettlement_amounts" CHECK (
  "liabIgst" >= 0 AND "liabCgst" >= 0 AND "liabSgst" >= 0 AND "rcmIgst" >= 0 AND "rcmCgst" >= 0 AND "rcmSgst" >= 0
  AND "useIgstIgst" >= 0 AND "useIgstCgst" >= 0 AND "useIgstSgst" >= 0 AND "useCgstCgst" >= 0 AND "useCgstIgst" >= 0 AND "useSgstSgst" >= 0 AND "useSgstIgst" >= 0
  AND "cashIgst" >= 0 AND "cashCgst" >= 0 AND "cashSgst" >= 0 AND "closeIgst" >= 0 AND "closeCgst" >= 0 AND "closeSgst" >= 0);
ALTER TABLE "Gstr2bImport" ADD CONSTRAINT "Gstr2bImport_period" CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
ALTER TABLE "Gstr2bRow" ADD CONSTRAINT "Gstr2bRow_kind" CHECK (kind IN ('INV', 'CN', 'DN'));
