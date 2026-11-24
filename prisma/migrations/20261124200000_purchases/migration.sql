-- CreateEnum
CREATE TYPE "SupplierKind" AS ENUM ('GOODS', 'SERVICES', 'OTHER');

-- CreateEnum
CREATE TYPE "PurchaseDocType" AS ENUM ('BILL', 'DEBIT_NOTE', 'CREDIT_NOTE');

-- CreateEnum
CREATE TYPE "PurchaseLineTarget" AS ENUM ('GOODS', 'HEAD', 'CLAIM');

-- CreateEnum
CREATE TYPE "SupplierBillKind" AS ENUM ('PURCHASE', 'OPENING');

-- CreateEnum
CREATE TYPE "SupplierCreditKind" AS ENUM ('DEBIT_NOTE', 'CREDIT_NOTE', 'OPENING_ADVANCE', 'PAYMENT');

-- AlterTable
ALTER TABLE "JournalEntry" ADD COLUMN     "supplierId" TEXT;

-- AlterTable
ALTER TABLE "LedgerAccount" ADD COLUMN     "supplierId" TEXT;

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "bankAccountNo" TEXT,
ADD COLUMN     "bankIfsc" TEXT,
ADD COLUMN     "bankName" TEXT,
ADD COLUMN     "creditDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "kind" "SupplierKind" NOT NULL DEFAULT 'GOODS',
ADD COLUMN     "pan" TEXT,
ADD COLUMN     "stateCode" TEXT,
ADD COLUMN     "tdsSection" TEXT;

-- CreateTable
CREATE TABLE "PurchaseBill" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "type" "PurchaseDocType" NOT NULL DEFAULT 'BILL',
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "supplierRef" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "dueDate" DATE,
    "stateCode" TEXT,
    "interState" BOOLEAN NOT NULL DEFAULT false,
    "reverseCharge" BOOLEAN NOT NULL DEFAULT false,
    "ratesIncludeGst" BOOLEAN NOT NULL DEFAULT false,
    "againstId" TEXT,
    "purchaseId" TEXT,
    "movedStock" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "taxable" INTEGER NOT NULL DEFAULT 0,
    "cgst" INTEGER NOT NULL DEFAULT 0,
    "sgst" INTEGER NOT NULL DEFAULT 0,
    "igst" INTEGER NOT NULL DEFAULT 0,
    "itcTax" INTEGER NOT NULL DEFAULT 0,
    "roundOff" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "entryId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseBill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseBillLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "billId" TEXT NOT NULL,
    "target" "PurchaseLineTarget" NOT NULL DEFAULT 'GOODS',
    "productId" TEXT,
    "headId" TEXT,
    "description" TEXT NOT NULL,
    "hsnCode" TEXT,
    "quantity" INTEGER NOT NULL,
    "freeQty" INTEGER NOT NULL DEFAULT 0,
    "rate" INTEGER NOT NULL,
    "discountPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "gstRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "itc" BOOLEAN NOT NULL DEFAULT true,
    "taxable" INTEGER NOT NULL,
    "cgst" INTEGER NOT NULL DEFAULT 0,
    "sgst" INTEGER NOT NULL DEFAULT 0,
    "igst" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "purchaseLineId" TEXT,
    "batch" TEXT,
    "expiry" DATE,

    CONSTRAINT "PurchaseBillLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierBill" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "supplierId" TEXT NOT NULL,
    "kind" "SupplierBillKind" NOT NULL DEFAULT 'PURCHASE',
    "number" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "amount" INTEGER NOT NULL,
    "paid" INTEGER NOT NULL DEFAULT 0,
    "settled" BOOLEAN NOT NULL DEFAULT false,
    "purchaseBillId" TEXT,
    "entryId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierBill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierCredit" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "supplierId" TEXT NOT NULL,
    "kind" "SupplierCreditKind" NOT NULL,
    "number" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" INTEGER NOT NULL,
    "allocated" INTEGER NOT NULL DEFAULT 0,
    "purchaseBillId" TEXT,
    "againstBillId" TEXT,
    "entryId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierCredit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierAllocation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "creditId" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseBill_purchaseId_key" ON "PurchaseBill"("purchaseId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseBill_entryId_key" ON "PurchaseBill"("entryId");

-- CreateIndex
CREATE INDEX "PurchaseBill_tenantId_date_idx" ON "PurchaseBill"("tenantId", "date");

-- CreateIndex
CREATE INDEX "PurchaseBill_tenantId_supplierId_date_idx" ON "PurchaseBill"("tenantId", "supplierId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseBill_tenantId_number_key" ON "PurchaseBill"("tenantId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseBill_tenantId_supplierId_type_supplierRef_key" ON "PurchaseBill"("tenantId", "supplierId", "type", "supplierRef");

-- CreateIndex
CREATE INDEX "PurchaseBillLine_tenantId_billId_idx" ON "PurchaseBillLine"("tenantId", "billId");

-- CreateIndex
CREATE INDEX "PurchaseBillLine_tenantId_productId_idx" ON "PurchaseBillLine"("tenantId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierBill_purchaseBillId_key" ON "SupplierBill"("purchaseBillId");

-- CreateIndex
CREATE INDEX "SupplierBill_tenantId_supplierId_settled_idx" ON "SupplierBill"("tenantId", "supplierId", "settled");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierCredit_purchaseBillId_key" ON "SupplierCredit"("purchaseBillId");

-- CreateIndex
CREATE INDEX "SupplierCredit_tenantId_supplierId_idx" ON "SupplierCredit"("tenantId", "supplierId");

-- CreateIndex
CREATE INDEX "SupplierAllocation_tenantId_creditId_idx" ON "SupplierAllocation"("tenantId", "creditId");

-- CreateIndex
CREATE INDEX "SupplierAllocation_tenantId_billId_idx" ON "SupplierAllocation"("tenantId", "billId");

-- CreateIndex
CREATE INDEX "JournalEntry_tenantId_supplierId_occurredAt_idx" ON "JournalEntry"("tenantId", "supplierId", "occurredAt");

-- AddForeignKey
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseBill" ADD CONSTRAINT "PurchaseBill_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseBill" ADD CONSTRAINT "PurchaseBill_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseBill" ADD CONSTRAINT "PurchaseBill_againstId_fkey" FOREIGN KEY ("againstId") REFERENCES "PurchaseBill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseBill" ADD CONSTRAINT "PurchaseBill_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseBillLine" ADD CONSTRAINT "PurchaseBillLine_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseBillLine" ADD CONSTRAINT "PurchaseBillLine_billId_fkey" FOREIGN KEY ("billId") REFERENCES "PurchaseBill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierBill" ADD CONSTRAINT "SupplierBill_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierBill" ADD CONSTRAINT "SupplierBill_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierCredit" ADD CONSTRAINT "SupplierCredit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierCredit" ADD CONSTRAINT "SupplierCredit_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierAllocation" ADD CONSTRAINT "SupplierAllocation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierAllocation" ADD CONSTRAINT "SupplierAllocation_creditId_fkey" FOREIGN KEY ("creditId") REFERENCES "SupplierCredit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierAllocation" ADD CONSTRAINT "SupplierAllocation_billId_fkey" FOREIGN KEY ("billId") REFERENCES "SupplierBill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-level security: each business sees only its own rows.
ALTER TABLE "PurchaseBill" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PurchaseBill" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PurchaseBill" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "PurchaseBillLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PurchaseBillLine" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PurchaseBillLine" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "SupplierBill" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupplierBill" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SupplierBill" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "SupplierCredit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupplierCredit" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SupplierCredit" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "SupplierAllocation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupplierAllocation" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SupplierAllocation" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');

-- Amounts never go below zero.
ALTER TABLE "SupplierBill" ADD CONSTRAINT "SupplierBill_paid_range" CHECK (paid >= 0 AND paid <= amount);
ALTER TABLE "SupplierCredit" ADD CONSTRAINT "SupplierCredit_alloc_range" CHECK (allocated >= 0 AND allocated <= amount);
