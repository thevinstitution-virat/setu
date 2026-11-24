-- CreateEnum
CREATE TYPE "VoucherType" AS ENUM ('PAYMENT', 'RECEIPT', 'CONTRA', 'JOURNAL');

-- CreateEnum
CREATE TYPE "VoucherMethod" AS ENUM ('CASH', 'BANK', 'CHEQUE', 'STAFF');

-- CreateEnum
CREATE TYPE "VoucherLineRole" AS ENUM ('ACCOUNT', 'MONEY', 'GST', 'TDS');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EntryKind" ADD VALUE 'VOUCHER_PAYMENT';
ALTER TYPE "EntryKind" ADD VALUE 'VOUCHER_RECEIPT';
ALTER TYPE "EntryKind" ADD VALUE 'CONTRA';
ALTER TYPE "EntryKind" ADD VALUE 'JOURNAL';

-- AlterTable
ALTER TABLE "CashHandover" ADD COLUMN     "expenses" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Voucher" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "number" TEXT NOT NULL,
    "type" "VoucherType" NOT NULL,
    "date" DATE NOT NULL,
    "method" "VoucherMethod",
    "bankAccountId" TEXT,
    "staffUserId" TEXT,
    "handoverId" TEXT,
    "amount" INTEGER NOT NULL,
    "party" TEXT,
    "partyGstin" TEXT,
    "gst" INTEGER NOT NULL DEFAULT 0,
    "tds" INTEGER NOT NULL DEFAULT 0,
    "tdsSection" TEXT,
    "reference" TEXT,
    "narration" TEXT,
    "photos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "entryId" TEXT,
    "chequeId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Voucher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoucherLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "voucherId" TEXT NOT NULL,
    "sl" INTEGER NOT NULL,
    "role" "VoucherLineRole" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "note" TEXT,

    CONSTRAINT "VoucherLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Voucher_entryId_key" ON "Voucher"("entryId");

-- CreateIndex
CREATE UNIQUE INDEX "Voucher_chequeId_key" ON "Voucher"("chequeId");

-- CreateIndex
CREATE INDEX "Voucher_tenantId_type_date_idx" ON "Voucher"("tenantId", "type", "date");

-- CreateIndex
CREATE INDEX "Voucher_tenantId_date_idx" ON "Voucher"("tenantId", "date");

-- CreateIndex
CREATE INDEX "Voucher_tenantId_staffUserId_idx" ON "Voucher"("tenantId", "staffUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Voucher_tenantId_number_key" ON "Voucher"("tenantId", "number");

-- CreateIndex
CREATE INDEX "VoucherLine_tenantId_voucherId_idx" ON "VoucherLine"("tenantId", "voucherId");

-- CreateIndex
CREATE INDEX "VoucherLine_tenantId_code_idx" ON "VoucherLine"("tenantId", "code");

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_chequeId_fkey" FOREIGN KEY ("chequeId") REFERENCES "IssuedCheque"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherLine" ADD CONSTRAINT "VoucherLine_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherLine" ADD CONSTRAINT "VoucherLine_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "Voucher"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Row-level security, as on every tenant table.
ALTER TABLE "Voucher" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Voucher" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Voucher" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "VoucherLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VoucherLine" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "VoucherLine" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');

-- Money is never negative; a voucher line is never zero.
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_amounts" CHECK (amount > 0 AND gst >= 0 AND tds >= 0);
ALTER TABLE "VoucherLine" ADD CONSTRAINT "VoucherLine_amount" CHECK (amount <> 0);
ALTER TABLE "CashHandover" ADD CONSTRAINT "CashHandover_expenses" CHECK (expenses >= 0);
