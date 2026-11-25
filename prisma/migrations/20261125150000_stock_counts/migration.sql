-- CreateEnum
CREATE TYPE "StockCountMode" AS ENUM ('TRACKED', 'QUANTITY', 'VALUE');

-- CreateEnum
CREATE TYPE "StockCountStatus" AS ENUM ('DRAFT', 'ACCEPTED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "EntryKind" ADD VALUE IF NOT EXISTS 'STOCK_COUNT';

-- CreateTable
CREATE TABLE "StockCount" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "number" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "mode" "StockCountMode" NOT NULL,
    "status" "StockCountStatus" NOT NULL DEFAULT 'DRAFT',
    "locationId" TEXT,
    "supplierId" TEXT,
    "categoryId" TEXT,
    "note" TEXT,
    "bookValue" BIGINT NOT NULL DEFAULT 0,
    "countedValue" BIGINT NOT NULL DEFAULT 0,
    "shortage" BIGINT NOT NULL DEFAULT 0,
    "excess" BIGINT NOT NULL DEFAULT 0,
    "entryId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedById" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,

    CONSTRAINT "StockCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCountLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "countId" TEXT NOT NULL,
    "sl" INTEGER NOT NULL,
    "productId" TEXT,
    "supplierId" TEXT,
    "lotId" TEXT,
    "batch" TEXT NOT NULL DEFAULT '',
    "expiry" DATE,
    "bookQty" INTEGER NOT NULL DEFAULT 0,
    "countedQty" INTEGER,
    "rate" INTEGER,
    "value" BIGINT,
    "added" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,

    CONSTRAINT "StockCountLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockCount_entryId_key" ON "StockCount"("entryId");

-- CreateIndex
CREATE INDEX "StockCount_tenantId_date_idx" ON "StockCount"("tenantId", "date");

-- CreateIndex
CREATE INDEX "StockCount_tenantId_status_idx" ON "StockCount"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StockCount_tenantId_number_key" ON "StockCount"("tenantId", "number");

-- CreateIndex
CREATE INDEX "StockCountLine_countId_idx" ON "StockCountLine"("countId");

-- CreateIndex
CREATE INDEX "StockCountLine_tenantId_productId_idx" ON "StockCountLine"("tenantId", "productId");

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_countId_fkey" FOREIGN KEY ("countId") REFERENCES "StockCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row-level security, as on every tenant table.
ALTER TABLE "StockCount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StockCount" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "StockCount" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "StockCountLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StockCountLine" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "StockCountLine" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');

-- Quantities, rates and values are never negative; a tracked count has a place.
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_amounts" CHECK ("bookValue" >= 0 AND "countedValue" >= 0 AND shortage >= 0 AND excess >= 0);
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_place" CHECK (mode <> 'TRACKED' OR "locationId" IS NOT NULL);
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_amounts" CHECK ("bookQty" >= 0 AND ("countedQty" IS NULL OR "countedQty" >= 0) AND (rate IS NULL OR rate >= 0) AND (value IS NULL OR value >= 0));
