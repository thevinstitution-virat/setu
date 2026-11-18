/*
  Warnings:

  - You are about to drop the column `category` on the `Product` table. All the data in the column will be lost.
  - You are about to drop the column `imageUrl` on the `Product` table. All the data in the column will be lost.
  - Added the required column `categoryId` to the `Product` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "SchemeType" AS ENUM ('BUY_X_GET_Y', 'SLAB', 'PERCENT', 'FLAT');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "couponCode" TEXT,
ADD COLUMN     "deliveryCharge" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "deliveryDate" DATE,
ADD COLUMN     "discountAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "grossAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "priceListId" TEXT;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "caseSize" INTEGER,
ADD COLUMN     "cases" INTEGER,
ADD COLUMN     "discount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "freeSchemeId" TEXT,
ADD COLUMN     "mrp" INTEGER;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "aliases" TEXT,
ADD COLUMN     "brandId" TEXT,
ADD COLUMN     "caseSize" INTEGER,
ADD COLUMN     "caseUnit" TEXT,
ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "hsnCode" TEXT,
ADD COLUMN     "images" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "moq" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "nameHi" TEXT,
ADD COLUMN     "sort" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "visibleAreaIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "visibleGroupIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "RetailerProfile" ADD COLUMN     "priceListId" TEXT;

-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "name" TEXT NOT NULL,
    "logoKey" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "imageKey" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HsnCode" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "code" TEXT NOT NULL,
    "description" TEXT,
    "gstRate" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "HsnCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceList" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceListItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "priceListId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "price" INTEGER NOT NULL,

    CONSTRAINT "PriceListItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetailerPrice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "retailerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "note" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetailerPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetailerGroup" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetailerGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetailerGroupMember" (
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "groupId" TEXT NOT NULL,
    "retailerId" TEXT NOT NULL,

    CONSTRAINT "RetailerGroupMember_pkey" PRIMARY KEY ("groupId","retailerId")
);

-- CreateTable
CREATE TABLE "Scheme" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "SchemeType" NOT NULL,
    "params" JSONB NOT NULL,
    "productIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "brandIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "categoryIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "areaIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "groupIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "retailerIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "couponCode" TEXT,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "priority" INTEGER NOT NULL DEFAULT 100,
    "stackable" BOOLEAN NOT NULL DEFAULT true,
    "budget" INTEGER,
    "spent" INTEGER NOT NULL DEFAULT 0,
    "maxUsesPerRetailer" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Scheme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchemeRedemption" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "schemeId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "retailerId" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "freeQty" INTEGER NOT NULL DEFAULT 0,
    "reversed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchemeRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Banner" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "imageKey" TEXT,
    "linkType" TEXT,
    "linkId" TEXT,
    "areaIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "groupIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "sort" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Banner_pkey" PRIMARY KEY ("id")
);

-- Backfill (hand-written): one Category per distinct product category string per
-- tenant, products point at it, imageUrl moves into images. Runs with RLS bypassed.
SELECT set_config('app.bypass_rls', 'on', false);
INSERT INTO "Category" ("id", "tenantId", "name")
SELECT 'cat_' || md5(c."tenantId" || ':' || c."category"), c."tenantId", c."category"
FROM (SELECT DISTINCT "tenantId", "category" FROM "Product") c;
UPDATE "Product" SET "categoryId" = 'cat_' || md5("tenantId" || ':' || "category");
UPDATE "Product" SET "images" = ARRAY["imageUrl"] WHERE "imageUrl" IS NOT NULL AND "imageUrl" <> '';
ALTER TABLE "Product" ALTER COLUMN "categoryId" SET NOT NULL;
ALTER TABLE "Product" DROP COLUMN "category", DROP COLUMN "imageUrl";
UPDATE "Order" SET "grossAmount" = "subtotal";

-- CreateIndex
CREATE UNIQUE INDEX "Brand_tenantId_name_key" ON "Brand"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Category_tenantId_name_key" ON "Category"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "HsnCode_tenantId_code_key" ON "HsnCode"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "PriceList_tenantId_name_key" ON "PriceList"("tenantId", "name");

-- CreateIndex
CREATE INDEX "PriceListItem_tenantId_productId_idx" ON "PriceListItem"("tenantId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "PriceListItem_priceListId_productId_key" ON "PriceListItem"("priceListId", "productId");

-- CreateIndex
CREATE INDEX "RetailerPrice_tenantId_productId_idx" ON "RetailerPrice"("tenantId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "RetailerPrice_retailerId_productId_key" ON "RetailerPrice"("retailerId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "RetailerGroup_tenantId_name_key" ON "RetailerGroup"("tenantId", "name");

-- CreateIndex
CREATE INDEX "RetailerGroupMember_tenantId_retailerId_idx" ON "RetailerGroupMember"("tenantId", "retailerId");

-- CreateIndex
CREATE INDEX "Scheme_tenantId_active_idx" ON "Scheme"("tenantId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Scheme_tenantId_couponCode_key" ON "Scheme"("tenantId", "couponCode");

-- CreateIndex
CREATE INDEX "SchemeRedemption_tenantId_schemeId_idx" ON "SchemeRedemption"("tenantId", "schemeId");

-- CreateIndex
CREATE INDEX "SchemeRedemption_tenantId_retailerId_schemeId_idx" ON "SchemeRedemption"("tenantId", "retailerId", "schemeId");

-- CreateIndex
CREATE INDEX "SchemeRedemption_tenantId_orderId_idx" ON "SchemeRedemption"("tenantId", "orderId");

-- CreateIndex
CREATE INDEX "Banner_tenantId_active_idx" ON "Banner"("tenantId", "active");

-- CreateIndex
CREATE INDEX "Product_tenantId_categoryId_idx" ON "Product"("tenantId", "categoryId");

-- CreateIndex
CREATE INDEX "Product_tenantId_brandId_idx" ON "Product"("tenantId", "brandId");

-- AddForeignKey
ALTER TABLE "RetailerProfile" ADD CONSTRAINT "RetailerProfile_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Brand" ADD CONSTRAINT "Brand_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HsnCode" ADD CONSTRAINT "HsnCode_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceList" ADD CONSTRAINT "PriceList_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceListItem" ADD CONSTRAINT "PriceListItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceListItem" ADD CONSTRAINT "PriceListItem_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceListItem" ADD CONSTRAINT "PriceListItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailerPrice" ADD CONSTRAINT "RetailerPrice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailerPrice" ADD CONSTRAINT "RetailerPrice_retailerId_fkey" FOREIGN KEY ("retailerId") REFERENCES "RetailerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailerPrice" ADD CONSTRAINT "RetailerPrice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailerGroup" ADD CONSTRAINT "RetailerGroup_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailerGroupMember" ADD CONSTRAINT "RetailerGroupMember_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailerGroupMember" ADD CONSTRAINT "RetailerGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "RetailerGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailerGroupMember" ADD CONSTRAINT "RetailerGroupMember_retailerId_fkey" FOREIGN KEY ("retailerId") REFERENCES "RetailerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scheme" ADD CONSTRAINT "Scheme_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchemeRedemption" ADD CONSTRAINT "SchemeRedemption_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchemeRedemption" ADD CONSTRAINT "SchemeRedemption_schemeId_fkey" FOREIGN KEY ("schemeId") REFERENCES "Scheme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Banner" ADD CONSTRAINT "Banner_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-level security (hand-written), same policy as every tenant table.
ALTER TABLE "Brand" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Brand" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Brand" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "Category" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Category" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Category" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "HsnCode" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HsnCode" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "HsnCode" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "PriceList" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PriceList" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PriceList" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "PriceListItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PriceListItem" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PriceListItem" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "RetailerPrice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RetailerPrice" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RetailerPrice" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "RetailerGroup" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RetailerGroup" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RetailerGroup" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "RetailerGroupMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RetailerGroupMember" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RetailerGroupMember" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "Scheme" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Scheme" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Scheme" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "SchemeRedemption" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SchemeRedemption" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SchemeRedemption" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "Banner" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Banner" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Banner" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');

-- Money and stock sanity (hand-written).
ALTER TABLE "PriceListItem" ADD CONSTRAINT "PriceListItem_price_nonneg" CHECK ("price" >= 0);
ALTER TABLE "RetailerPrice" ADD CONSTRAINT "RetailerPrice_price_nonneg" CHECK ("price" >= 0);
ALTER TABLE "Product" ADD CONSTRAINT "Product_case_valid" CHECK (("caseUnit" IS NULL AND "caseSize" IS NULL) OR ("caseUnit" IS NOT NULL AND "caseSize" > 1));
ALTER TABLE "Product" ADD CONSTRAINT "Product_moq_pos" CHECK ("moq" >= 1);
ALTER TABLE "Scheme" ADD CONSTRAINT "Scheme_budget_valid" CHECK ("spent" >= 0 AND ("budget" IS NULL OR "budget" >= 0));
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_discount_valid" CHECK ("discount" >= 0 AND "discount" <= "price" * "quantity");
ALTER TABLE "Order" ADD CONSTRAINT "Order_charges_nonneg" CHECK ("discountAmount" >= 0 AND "deliveryCharge" >= 0 AND "grossAmount" >= 0);
SELECT set_config('app.bypass_rls', 'off', false);
