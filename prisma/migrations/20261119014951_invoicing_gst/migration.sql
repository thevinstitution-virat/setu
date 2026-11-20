-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('TAX_INVOICE', 'BILL_OF_SUPPLY', 'CREDIT_NOTE', 'DEBIT_NOTE');

-- CreateEnum
CREATE TYPE "EInvoiceStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'GENERATED', 'FAILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "deliveryGstRate" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "RetailerProfile" ADD COLUMN     "gstin" TEXT,
ADD COLUMN     "legalName" TEXT,
ADD COLUMN     "stateCode" TEXT;

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "type" "InvoiceType" NOT NULL,
    "number" TEXT NOT NULL,
    "fy" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "orderId" TEXT,
    "retailerId" TEXT NOT NULL,
    "originalId" TEXT,
    "noteKind" TEXT,
    "reason" TEXT,
    "seller" JSONB NOT NULL,
    "buyer" JSONB NOT NULL,
    "b2b" BOOLEAN NOT NULL,
    "placeOfSupply" TEXT NOT NULL,
    "interState" BOOLEAN NOT NULL,
    "taxable" INTEGER NOT NULL,
    "cgst" INTEGER NOT NULL,
    "sgst" INTEGER NOT NULL,
    "igst" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "entryId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "einvStatus" "EInvoiceStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "irn" TEXT,
    "ackNo" TEXT,
    "ackDate" TIMESTAMP(3),
    "signedQr" TEXT,
    "einvError" TEXT,
    "einvAttempts" INTEGER NOT NULL DEFAULT 0,
    "einvCancelledAt" TIMESTAMP(3),
    "ewbNo" TEXT,
    "ewbDate" TIMESTAMP(3),
    "ewbValidUntil" TIMESTAMP(3),
    "ewbVehicle" TEXT,
    "ewbDistanceKm" INTEGER,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "invoiceId" TEXT NOT NULL,
    "sl" INTEGER NOT NULL,
    "productId" TEXT,
    "orderItemId" TEXT,
    "originalLineId" TEXT,
    "description" TEXT NOT NULL,
    "hsnCode" TEXT,
    "isService" BOOLEAN NOT NULL DEFAULT false,
    "unit" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "freeQty" INTEGER NOT NULL DEFAULT 0,
    "rate" INTEGER NOT NULL,
    "gross" INTEGER NOT NULL,
    "discount" INTEGER NOT NULL,
    "taxable" INTEGER NOT NULL,
    "gstRate" DOUBLE PRECISION NOT NULL,
    "cgst" INTEGER NOT NULL,
    "sgst" INTEGER NOT NULL,
    "igst" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Invoice_tenantId_date_idx" ON "Invoice"("tenantId", "date");

-- CreateIndex
CREATE INDEX "Invoice_tenantId_retailerId_date_idx" ON "Invoice"("tenantId", "retailerId", "date");

-- CreateIndex
CREATE INDEX "Invoice_tenantId_orderId_idx" ON "Invoice"("tenantId", "orderId");

-- CreateIndex
CREATE INDEX "Invoice_tenantId_originalId_idx" ON "Invoice"("tenantId", "originalId");

-- CreateIndex
CREATE INDEX "Invoice_tenantId_einvStatus_idx" ON "Invoice"("tenantId", "einvStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_tenantId_number_key" ON "Invoice"("tenantId", "number");

-- CreateIndex
CREATE INDEX "InvoiceLine_tenantId_invoiceId_idx" ON "InvoiceLine"("tenantId", "invoiceId");

-- CreateIndex
CREATE INDEX "InvoiceLine_tenantId_originalLineId_idx" ON "InvoiceLine"("tenantId", "originalLineId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_retailerId_fkey" FOREIGN KEY ("retailerId") REFERENCES "RetailerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_originalId_fkey" FOREIGN KEY ("originalId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───────── Hand-written: backfill, RLS, integrity, immutability ─────────

SELECT set_config('app.bypass_rls', 'on', false);

-- Orders placed before this migration: delivery charge GST from the tenant's cart rules (default 18%).
UPDATE "Order" o
SET "deliveryGstRate" = COALESCE((t."settings"->'cart'->>'deliveryGstRate')::double precision, 18)
FROM "Tenant" t
WHERE o."tenantId" = t."id" AND o."deliveryCharge" > 0;

-- One sale document per order (credit / debit notes can be many).
CREATE UNIQUE INDEX "Invoice_one_sale_per_order" ON "Invoice"("tenantId", "orderId")
  WHERE "type" IN ('TAX_INVOICE', 'BILL_OF_SUPPLY') AND "orderId" IS NOT NULL;

-- Amounts add up and are never negative.
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_amounts_check" CHECK (
  "taxable" >= 0 AND "cgst" >= 0 AND "sgst" >= 0 AND "igst" >= 0
  AND "total" = "taxable" + "cgst" + "sgst" + "igst"
  AND ("interState" OR "igst" = 0)
  AND (NOT "interState" OR ("cgst" = 0 AND "sgst" = 0))
);
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_note_check" CHECK (
  ("type" IN ('CREDIT_NOTE', 'DEBIT_NOTE')) = ("originalId" IS NOT NULL)
);
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_number_check" CHECK (char_length("number") <= 16 AND "number" ~ '^[A-Za-z0-9/-]+$');
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_amounts_check" CHECK (
  "quantity" >= 0 AND "freeQty" >= 0 AND "freeQty" <= "quantity" AND "rate" >= 0
  AND "gross" >= 0 AND "discount" >= 0 AND "taxable" = "gross" - "discount"
  AND "cgst" >= 0 AND "sgst" >= 0 AND "igst" >= 0
  AND "total" = "taxable" + "cgst" + "sgst" + "igst"
);

-- Tenant isolation, same policy as every tenant table.
ALTER TABLE "Invoice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Invoice" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Invoice" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "InvoiceLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InvoiceLine" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "InvoiceLine" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');

-- Issued documents are immutable: only the e-invoice / e-way bill fields and
-- the ledger link may be filled in later. Corrections are credit / debit notes.
CREATE OR REPLACE FUNCTION invoice_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Invoices cannot be deleted; issue a credit note instead';
  END IF;
  IF NEW."tenantId" IS DISTINCT FROM OLD."tenantId"
     OR NEW."type" IS DISTINCT FROM OLD."type"
     OR NEW."number" IS DISTINCT FROM OLD."number"
     OR NEW."fy" IS DISTINCT FROM OLD."fy"
     OR NEW."date" IS DISTINCT FROM OLD."date"
     OR NEW."orderId" IS DISTINCT FROM OLD."orderId"
     OR NEW."retailerId" IS DISTINCT FROM OLD."retailerId"
     OR NEW."originalId" IS DISTINCT FROM OLD."originalId"
     OR NEW."seller" IS DISTINCT FROM OLD."seller"
     OR NEW."buyer" IS DISTINCT FROM OLD."buyer"
     OR NEW."b2b" IS DISTINCT FROM OLD."b2b"
     OR NEW."placeOfSupply" IS DISTINCT FROM OLD."placeOfSupply"
     OR NEW."interState" IS DISTINCT FROM OLD."interState"
     OR NEW."taxable" IS DISTINCT FROM OLD."taxable"
     OR NEW."cgst" IS DISTINCT FROM OLD."cgst"
     OR NEW."sgst" IS DISTINCT FROM OLD."sgst"
     OR NEW."igst" IS DISTINCT FROM OLD."igst"
     OR NEW."total" IS DISTINCT FROM OLD."total"
     OR (OLD."entryId" IS NOT NULL AND NEW."entryId" IS DISTINCT FROM OLD."entryId")
  THEN
    RAISE EXCEPTION 'An issued invoice cannot be changed; issue a credit or debit note instead';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER invoice_guard BEFORE UPDATE OR DELETE ON "Invoice"
  FOR EACH ROW EXECUTE FUNCTION invoice_guard();

CREATE OR REPLACE FUNCTION invoice_line_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Invoice lines cannot be changed or deleted';
END $$ LANGUAGE plpgsql;

CREATE TRIGGER invoice_line_guard BEFORE UPDATE OR DELETE ON "InvoiceLine"
  FOR EACH ROW EXECUTE FUNCTION invoice_line_guard();
