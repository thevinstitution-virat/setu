-- CreateEnum
CREATE TYPE "SupplierPayMethod" AS ENUM ('BANK', 'CASH', 'CHEQUE');

-- CreateEnum
CREATE TYPE "IssuedChequeStatus" AS ENUM ('ISSUED', 'CLEARED', 'BOUNCED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EntryKind" ADD VALUE 'SUPPLIER_PAYMENT';
ALTER TYPE "EntryKind" ADD VALUE 'ISSUED_CHEQUE_CLEAR';

-- CreateTable
CREATE TABLE "SupplierPayment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "method" "SupplierPayMethod" NOT NULL,
    "bankAccountId" TEXT,
    "amount" INTEGER NOT NULL,
    "tds" INTEGER NOT NULL DEFAULT 0,
    "tdsSection" TEXT,
    "reference" TEXT,
    "note" TEXT,
    "creditId" TEXT,
    "entryId" TEXT,
    "chequeId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssuedCheque" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "number" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount" INTEGER NOT NULL,
    "payee" TEXT NOT NULL,
    "supplierId" TEXT,
    "status" "IssuedChequeStatus" NOT NULL DEFAULT 'ISSUED',
    "clearedAt" TIMESTAMP(3),
    "clearEntryId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssuedCheque_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPayment_creditId_key" ON "SupplierPayment"("creditId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPayment_entryId_key" ON "SupplierPayment"("entryId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPayment_chequeId_key" ON "SupplierPayment"("chequeId");

-- CreateIndex
CREATE INDEX "SupplierPayment_tenantId_supplierId_idx" ON "SupplierPayment"("tenantId", "supplierId");

-- CreateIndex
CREATE INDEX "SupplierPayment_tenantId_date_idx" ON "SupplierPayment"("tenantId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPayment_tenantId_number_key" ON "SupplierPayment"("tenantId", "number");

-- CreateIndex
CREATE INDEX "IssuedCheque_tenantId_status_idx" ON "IssuedCheque"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "IssuedCheque_tenantId_bankAccountId_number_key" ON "IssuedCheque"("tenantId", "bankAccountId", "number");

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_chequeId_fkey" FOREIGN KEY ("chequeId") REFERENCES "IssuedCheque"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssuedCheque" ADD CONSTRAINT "IssuedCheque_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssuedCheque" ADD CONSTRAINT "IssuedCheque_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssuedCheque" ADD CONSTRAINT "IssuedCheque_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row-level security, as on every tenant table.
ALTER TABLE "SupplierPayment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupplierPayment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SupplierPayment" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "IssuedCheque" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IssuedCheque" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "IssuedCheque" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');

-- Money is never negative or zero.
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_amounts" CHECK (amount > 0 AND tds >= 0);
ALTER TABLE "IssuedCheque" ADD CONSTRAINT "IssuedCheque_amount" CHECK (amount > 0);
