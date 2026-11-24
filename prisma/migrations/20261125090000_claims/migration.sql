-- CreateEnum
CREATE TYPE "ClaimType" AS ENUM ('SCHEME', 'DAMAGE', 'RATE_DIFF', 'OTHER');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('RAISED', 'PART_SETTLED', 'SETTLED', 'REJECTED', 'WRITTEN_OFF');

-- CreateEnum
CREATE TYPE "ClaimSettlementKind" AS ENUM ('CREDIT_NOTE', 'RECEIPT', 'WRITE_OFF');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EntryKind" ADD VALUE 'CLAIM_RAISE';
ALTER TYPE "EntryKind" ADD VALUE 'CLAIM_RECEIPT';
ALTER TYPE "EntryKind" ADD VALUE 'CLAIM_WRITE_OFF';

-- AlterTable
ALTER TABLE "PurchaseBillLine" ADD COLUMN     "claimId" TEXT;

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "type" "ClaimType" NOT NULL,
    "date" DATE NOT NULL,
    "periodFrom" DATE,
    "periodTo" DATE,
    "reference" TEXT,
    "note" TEXT,
    "amount" INTEGER NOT NULL,
    "settled" INTEGER NOT NULL DEFAULT 0,
    "writtenOff" INTEGER NOT NULL DEFAULT 0,
    "status" "ClaimStatus" NOT NULL DEFAULT 'RAISED',
    "closeReason" TEXT,
    "entryId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "claimId" TEXT NOT NULL,
    "sl" INTEGER NOT NULL,
    "productId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "rate" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "evidence" TEXT,

    CONSTRAINT "ClaimLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimSettlement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "claimId" TEXT NOT NULL,
    "kind" "ClaimSettlementKind" NOT NULL,
    "date" DATE NOT NULL,
    "amount" INTEGER NOT NULL,
    "purchaseBillId" TEXT,
    "bankAccountId" TEXT,
    "cash" BOOLEAN NOT NULL DEFAULT false,
    "reference" TEXT,
    "note" TEXT,
    "entryId" TEXT,
    "reversedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Claim_entryId_key" ON "Claim"("entryId");

-- CreateIndex
CREATE INDEX "Claim_tenantId_supplierId_idx" ON "Claim"("tenantId", "supplierId");

-- CreateIndex
CREATE INDEX "Claim_tenantId_status_idx" ON "Claim"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Claim_tenantId_date_idx" ON "Claim"("tenantId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Claim_tenantId_number_key" ON "Claim"("tenantId", "number");

-- CreateIndex
CREATE INDEX "ClaimLine_tenantId_claimId_idx" ON "ClaimLine"("tenantId", "claimId");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimSettlement_entryId_key" ON "ClaimSettlement"("entryId");

-- CreateIndex
CREATE INDEX "ClaimSettlement_tenantId_claimId_idx" ON "ClaimSettlement"("tenantId", "claimId");

-- CreateIndex
CREATE INDEX "ClaimSettlement_tenantId_date_idx" ON "ClaimSettlement"("tenantId", "date");

-- CreateIndex
CREATE INDEX "ClaimSettlement_tenantId_purchaseBillId_idx" ON "ClaimSettlement"("tenantId", "purchaseBillId");

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimLine" ADD CONSTRAINT "ClaimLine_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimLine" ADD CONSTRAINT "ClaimLine_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimSettlement" ADD CONSTRAINT "ClaimSettlement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimSettlement" ADD CONSTRAINT "ClaimSettlement_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimSettlement" ADD CONSTRAINT "ClaimSettlement_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row-level security, as on every tenant table.
ALTER TABLE "Claim" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Claim" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Claim" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "ClaimLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClaimLine" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ClaimLine" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "ClaimSettlement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClaimSettlement" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ClaimSettlement" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');

-- Money is never negative, and a claim never settles past its amount.
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_amounts" CHECK (amount > 0 AND settled >= 0 AND "writtenOff" >= 0 AND settled + "writtenOff" <= amount);
ALTER TABLE "ClaimLine" ADD CONSTRAINT "ClaimLine_amounts" CHECK (amount > 0 AND quantity > 0 AND rate >= 0);
ALTER TABLE "ClaimSettlement" ADD CONSTRAINT "ClaimSettlement_amount" CHECK (amount > 0);
