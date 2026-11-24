-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EntryKind" ADD VALUE 'TDS_DEDUCTION';
ALTER TYPE "EntryKind" ADD VALUE 'TDS_PAYMENT';

-- AlterEnum
ALTER TYPE "PayMethod" ADD VALUE 'TDS';

-- AlterEnum
ALTER TYPE "SupplierCreditKind" ADD VALUE 'TDS';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "tdsSection" TEXT;

-- AlterTable
ALTER TABLE "SupplierCredit" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "tdsBase" INTEGER,
ADD COLUMN     "tdsSection" TEXT;

-- AlterTable
ALTER TABLE "SupplierPayment" ADD COLUMN     "tdsNote" TEXT;

-- AlterTable
ALTER TABLE "Voucher" ADD COLUMN     "partyPan" TEXT,
ADD COLUMN     "tdsNote" TEXT;

-- CreateTable
CREATE TABLE "TdsSection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rateInd" INTEGER NOT NULL,
    "rateOther" INTEGER NOT NULL,
    "rateNoPan" INTEGER NOT NULL,
    "single" INTEGER,
    "yearly" INTEGER,
    "overOnly" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TdsSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TdsChallan" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "number" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "tax" INTEGER NOT NULL,
    "interest" INTEGER NOT NULL DEFAULT 0,
    "lateFee" INTEGER NOT NULL DEFAULT 0,
    "bankAccountId" TEXT,
    "paidOn" DATE NOT NULL,
    "bsrCode" TEXT NOT NULL,
    "serial" TEXT NOT NULL,
    "note" TEXT,
    "entryId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TdsChallan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TdsSection_tenantId_code_key" ON "TdsSection"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "TdsChallan_entryId_key" ON "TdsChallan"("entryId");

-- CreateIndex
CREATE INDEX "TdsChallan_tenantId_period_section_idx" ON "TdsChallan"("tenantId", "period", "section");

-- CreateIndex
CREATE UNIQUE INDEX "TdsChallan_tenantId_number_key" ON "TdsChallan"("tenantId", "number");

-- AddForeignKey
ALTER TABLE "TdsSection" ADD CONSTRAINT "TdsSection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TdsChallan" ADD CONSTRAINT "TdsChallan_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TdsChallan" ADD CONSTRAINT "TdsChallan_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Row-level security.
ALTER TABLE "TdsSection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TdsSection" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TdsSection" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "TdsChallan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TdsChallan" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TdsChallan" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');

-- Checks.
ALTER TABLE "TdsSection" ADD CONSTRAINT "TdsSection_rates" CHECK ("rateInd" BETWEEN 0 AND 5000 AND "rateOther" BETWEEN 0 AND 5000 AND "rateNoPan" BETWEEN 0 AND 5000 AND coalesce("single", 0) >= 0 AND coalesce("yearly", 0) >= 0);
ALTER TABLE "TdsChallan" ADD CONSTRAINT "TdsChallan_period" CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
ALTER TABLE "TdsChallan" ADD CONSTRAINT "TdsChallan_amounts" CHECK (tax >= 0 AND interest >= 0 AND "lateFee" >= 0 AND tax + interest + "lateFee" > 0);
ALTER TABLE "TdsChallan" ADD CONSTRAINT "TdsChallan_counterfoil" CHECK ("bsrCode" ~ '^[0-9]{7}$' AND serial ~ '^[0-9]{5}$');
ALTER TABLE "SupplierCredit" ADD CONSTRAINT "SupplierCredit_tds" CHECK (kind::text <> 'TDS' OR ("tdsSection" IS NOT NULL AND "tdsBase" > 0));
