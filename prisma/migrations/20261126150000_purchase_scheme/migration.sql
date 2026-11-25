-- AlterTable
ALTER TABLE "PurchaseBillLine" ADD COLUMN     "schemeAmount" INTEGER NOT NULL DEFAULT 0;

-- The scheme discount is an amount off the line, never negative.
ALTER TABLE "PurchaseBillLine" ADD CONSTRAINT "PurchaseBillLine_scheme" CHECK ("schemeAmount" >= 0);
