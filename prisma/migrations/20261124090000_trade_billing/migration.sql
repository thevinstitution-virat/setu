-- Trade billing: rates that include GST, salesman on orders and bills, bill print details, shop contact.

ALTER TABLE "RetailerProfile" ADD COLUMN "contactName" TEXT;
ALTER TABLE "RetailerProfile" ADD COLUMN "altPhone" TEXT;

ALTER TABLE "Order" ADD COLUMN "taxInclusive" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Order" ADD COLUMN "salesmanId" TEXT;

ALTER TABLE "Bill" ADD COLUMN "salesmanId" TEXT;
CREATE INDEX "Bill_tenantId_salesmanId_settled_idx" ON "Bill"("tenantId", "salesmanId", "settled");

ALTER TABLE "Invoice" ADD COLUMN "salesman" TEXT;

ALTER TABLE "InvoiceLine" ADD COLUMN "inclRate" INTEGER;
ALTER TABLE "InvoiceLine" ADD COLUMN "mrp" INTEGER;
ALTER TABLE "InvoiceLine" ADD COLUMN "caseSize" INTEGER;
