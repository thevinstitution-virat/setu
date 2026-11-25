-- AlterTable
ALTER TABLE "PurchaseBill" ADD COLUMN     "ewayBill" TEXT,
ADD COLUMN     "irn" TEXT,
ADD COLUMN     "poNumber" TEXT,
ADD COLUMN     "scans" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "transporter" TEXT,
ADD COLUMN     "vehicleNo" TEXT;

-- AlterTable
ALTER TABLE "PurchaseBillLine" ADD COLUMN     "caseRate" INTEGER,
ADD COLUMN     "caseSize" INTEGER,
ADD COLUMN     "cases" INTEGER,
ADD COLUMN     "discount2Pct" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "discount3Pct" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "mrp" INTEGER;


-- A line billed by the case has all three; units per case and the case rate are positive.
ALTER TABLE "PurchaseBillLine" ADD CONSTRAINT "PurchaseBillLine_cases" CHECK (
  ("cases" IS NULL AND "caseSize" IS NULL AND "caseRate" IS NULL)
  OR ("cases" >= 0 AND "caseSize" >= 1 AND "caseRate" >= 0 AND "quantity" >= "cases" * "caseSize")
);
ALTER TABLE "PurchaseBillLine" ADD CONSTRAINT "PurchaseBillLine_discounts" CHECK ("discount2Pct" >= 0 AND "discount2Pct" <= 100 AND "discount3Pct" >= 0 AND "discount3Pct" <= 100);
ALTER TABLE "PurchaseBillLine" ADD CONSTRAINT "PurchaseBillLine_mrp" CHECK ("mrp" IS NULL OR "mrp" >= 0);
ALTER TABLE "PurchaseBill" ADD CONSTRAINT "PurchaseBill_scans" CHECK (cardinality("scans") <= 10);
