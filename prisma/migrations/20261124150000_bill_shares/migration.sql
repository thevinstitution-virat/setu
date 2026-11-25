-- Company-wise outstanding: a bill's value by company (principal supplier),
-- for bills imported from the old book (they have no invoice lines to split).

-- CreateTable
CREATE TABLE "BillShare" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "billId" TEXT NOT NULL,
    "supplierId" TEXT,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BillShare_tenantId_billId_idx" ON "BillShare"("tenantId", "billId");

-- CreateIndex
CREATE INDEX "BillShare_tenantId_supplierId_idx" ON "BillShare"("tenantId", "supplierId");

-- AddForeignKey
ALTER TABLE "BillShare" ADD CONSTRAINT "BillShare_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillShare" ADD CONSTRAINT "BillShare_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillShare" ADD CONSTRAINT "BillShare_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One business's shares are invisible to every other business.
ALTER TABLE "BillShare" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BillShare" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "BillShare" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
