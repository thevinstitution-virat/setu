-- Accounts A1: chart of accounts (groups + the business's own heads), any
-- number of bank accounts, the books lock, and the accountant role.

-- CreateEnum
CREATE TYPE "AccountGroup" AS ENUM ('CAPITAL', 'DRAWINGS', 'LOANS', 'CURRENT_LIABILITIES', 'CREDITORS', 'DUTIES_TAXES', 'FIXED_ASSETS', 'DEBTORS', 'CLAIMS', 'CASH', 'BANK', 'IN_TRANSIT', 'CURRENT_ASSETS', 'SALES', 'PURCHASES', 'DIRECT_EXPENSES', 'INDIRECT_EXPENSES', 'OTHER_INCOME');

-- CreateEnum
CREATE TYPE "BankKind" AS ENUM ('CURRENT', 'SAVINGS', 'OD', 'CC');

-- AlterEnum (the new values are only used by later code, never in this file)
ALTER TYPE "AccountType" ADD VALUE 'PAYABLE';
ALTER TYPE "AccountType" ADD VALUE 'PURCHASES';
ALTER TYPE "AccountType" ADD VALUE 'PURCHASE_RETURNS';
ALTER TYPE "AccountType" ADD VALUE 'GST_INPUT';
ALTER TYPE "AccountType" ADD VALUE 'TDS_PAYABLE';
ALTER TYPE "AccountType" ADD VALUE 'TDS_RECEIVABLE';
ALTER TYPE "AccountType" ADD VALUE 'CLAIMS_RECEIVABLE';
ALTER TYPE "AccountType" ADD VALUE 'CLAIM_INCOME';
ALTER TYPE "AccountType" ADD VALUE 'ROUND_OFF';
ALTER TYPE "AccountType" ADD VALUE 'STOCK_LOSS';
ALTER TYPE "AccountType" ADD VALUE 'ISSUED_CHEQUES';
ALTER TYPE "AccountType" ADD VALUE 'HEAD';

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'ACCOUNTANT';

-- AlterTable
ALTER TABLE "BankStatement" ADD COLUMN "bankAccountId" TEXT;

-- AlterTable: group is filled in for the accounts that already exist, then required.
ALTER TABLE "LedgerAccount" ADD COLUMN "bankAccountId" TEXT,
ADD COLUMN "group" "AccountGroup",
ADD COLUMN "headId" TEXT;

-- Every business's accounts: RLS would otherwise hide them all from this script.
SELECT set_config('app.bypass_rls', 'on', true);
UPDATE "LedgerAccount" SET "group" = (CASE "type"::text
    WHEN 'RECEIVABLE' THEN 'DEBTORS'
    WHEN 'WALLET' THEN 'CURRENT_LIABILITIES'
    WHEN 'WALLET_HOLD' THEN 'CURRENT_LIABILITIES'
    WHEN 'STAFF_CASH' THEN 'CASH'
    WHEN 'OFFICE_CASH' THEN 'CASH'
    WHEN 'BANK' THEN 'BANK'
    WHEN 'UPI_CLEARING' THEN 'IN_TRANSIT'
    WHEN 'CHEQUES_IN_HAND' THEN 'IN_TRANSIT'
    WHEN 'GATEWAY_CLEARING' THEN 'IN_TRANSIT'
    WHEN 'SALES' THEN 'SALES'
    WHEN 'GST_OUTPUT' THEN 'DUTIES_TAXES'
    WHEN 'OPENING_EQUITY' THEN 'CAPITAL'
    WHEN 'PENALTY_INCOME' THEN 'OTHER_INCOME'
    ELSE 'INDIRECT_EXPENSES' -- DISCOUNT, CASH_SHORTAGE, PROMOTIONS, GATEWAY_FEES
  END)::"AccountGroup";
SELECT set_config('app.bypass_rls', 'off', true);

ALTER TABLE "LedgerAccount" ALTER COLUMN "group" SET NOT NULL;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "booksLockedUntil" DATE;

-- CreateTable
CREATE TABLE "LedgerHead" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "name" TEXT NOT NULL,
    "group" "AccountGroup" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "key" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerHead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankAccount" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "name" TEXT NOT NULL,
    "kind" "BankKind" NOT NULL DEFAULT 'CURRENT',
    "bankName" TEXT,
    "last4" TEXT,
    "ifsc" TEXT,
    "branch" TEXT,
    "odLimit" INTEGER,
    "ledgerCode" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LedgerHead_tenantId_name_key" ON "LedgerHead"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerHead_tenantId_key_key" ON "LedgerHead"("tenantId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "BankAccount_tenantId_name_key" ON "BankAccount"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "BankAccount_tenantId_ledgerCode_key" ON "BankAccount"("tenantId", "ledgerCode");

-- At most one default bank per business.
CREATE UNIQUE INDEX "BankAccount_one_default" ON "BankAccount"("tenantId") WHERE "isDefault";

-- CreateIndex
CREATE INDEX "LedgerAccount_tenantId_group_idx" ON "LedgerAccount"("tenantId", "group");

-- AddForeignKey
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_headId_fkey" FOREIGN KEY ("headId") REFERENCES "LedgerHead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerHead" ADD CONSTRAINT "LedgerHead_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatement" ADD CONSTRAINT "BankStatement_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One business's heads and banks are invisible to every other business.
ALTER TABLE "LedgerHead" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LedgerHead" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "LedgerHead" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE "BankAccount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BankAccount" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "BankAccount" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
