-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'RETAILER', 'SALES_AGENT', 'DELIVERY_AGENT');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PLACED', 'CONFIRMED', 'PACKED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'ONLINE', 'CREDIT');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'COLLECTED', 'SETTLED');

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('TRIAL', 'ACTIVE', 'SUSPENDED');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "gstin" TEXT,
    "stateCode" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "status" "TenantStatus" NOT NULL DEFAULT 'TRIAL',
    "plan" TEXT NOT NULL DEFAULT 'trial',
    "brand" JSONB NOT NULL DEFAULT '{}',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantDomain" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "loginId" TEXT,
    "passwordHash" TEXT,
    "role" "Role" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Region" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "name" TEXT NOT NULL,

    CONSTRAINT "Region_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Area" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "name" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,

    CONSTRAINT "Area_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetailerProfile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "userId" TEXT NOT NULL,
    "outletName" TEXT NOT NULL,
    "shopNumber" TEXT NOT NULL,
    "complexName" TEXT NOT NULL,
    "pinCode" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "salesAgentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetailerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesAgentProfile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "userId" TEXT NOT NULL,

    CONSTRAINT "SalesAgentProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Beat" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "name" TEXT NOT NULL,
    "salesAgentId" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,

    CONSTRAINT "Beat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryAgentProfile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "userId" TEXT NOT NULL,

    CONSTRAINT "DeliveryAgentProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "name" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "mrp" INTEGER NOT NULL,
    "gstRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "specialOffer" TEXT,
    "imageUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "orderNumber" TEXT NOT NULL,
    "retailerId" TEXT NOT NULL,
    "placedById" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'PLACED',
    "subtotal" INTEGER NOT NULL DEFAULT 0,
    "gstAmount" INTEGER NOT NULL DEFAULT 0,
    "totalAmount" INTEGER NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,
    "gstRate" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderStatusEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "orderId" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL,
    "note" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Visit" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "salesAgentId" TEXT NOT NULL,
    "retailerId" TEXT NOT NULL,
    "checkInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkInLat" DOUBLE PRECISION,
    "checkInLng" DOUBLE PRECISION,
    "checkOutAt" TIMESTAMP(3),
    "notes" TEXT,
    "orderId" TEXT,

    CONSTRAINT "Visit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "salesAgentId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "checkInAt" TIMESTAMP(3),
    "checkInLat" DOUBLE PRECISION,
    "checkInLng" DOUBLE PRECISION,
    "checkOutAt" TIMESTAMP(3),

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Delivery" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "orderId" TEXT NOT NULL,
    "deliveryAgentId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "podPhotoUrl" TEXT,
    "podSignatureData" TEXT,
    "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "codAmount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpChallenge" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Counter" (
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Counter_pkey" PRIMARY KEY ("tenantId","key")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "TenantDomain_host_key" ON "TenantDomain"("host");

-- CreateIndex
CREATE INDEX "User_tenantId_role_idx" ON "User"("tenantId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "User_tenantId_phone_key" ON "User"("tenantId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "User_tenantId_email_key" ON "User"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "User_tenantId_loginId_key" ON "User"("tenantId", "loginId");

-- CreateIndex
CREATE UNIQUE INDEX "Region_tenantId_name_key" ON "Region"("tenantId", "name");

-- CreateIndex
CREATE INDEX "Area_tenantId_idx" ON "Area"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Area_regionId_name_key" ON "Area"("regionId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "RetailerProfile_userId_key" ON "RetailerProfile"("userId");

-- CreateIndex
CREATE INDEX "RetailerProfile_tenantId_areaId_idx" ON "RetailerProfile"("tenantId", "areaId");

-- CreateIndex
CREATE INDEX "RetailerProfile_tenantId_salesAgentId_idx" ON "RetailerProfile"("tenantId", "salesAgentId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesAgentProfile_userId_key" ON "SalesAgentProfile"("userId");

-- CreateIndex
CREATE INDEX "SalesAgentProfile_tenantId_idx" ON "SalesAgentProfile"("tenantId");

-- CreateIndex
CREATE INDEX "Beat_tenantId_idx" ON "Beat"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryAgentProfile_userId_key" ON "DeliveryAgentProfile"("userId");

-- CreateIndex
CREATE INDEX "DeliveryAgentProfile_tenantId_idx" ON "DeliveryAgentProfile"("tenantId");

-- CreateIndex
CREATE INDEX "Product_tenantId_active_idx" ON "Product"("tenantId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Product_tenantId_sku_key" ON "Product"("tenantId", "sku");

-- CreateIndex
CREATE INDEX "Order_tenantId_status_createdAt_idx" ON "Order"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Order_tenantId_retailerId_createdAt_idx" ON "Order"("tenantId", "retailerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_tenantId_orderNumber_key" ON "Order"("tenantId", "orderNumber");

-- CreateIndex
CREATE INDEX "OrderItem_tenantId_orderId_idx" ON "OrderItem"("tenantId", "orderId");

-- CreateIndex
CREATE INDEX "OrderStatusEvent_tenantId_orderId_idx" ON "OrderStatusEvent"("tenantId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Visit_orderId_key" ON "Visit"("orderId");

-- CreateIndex
CREATE INDEX "Visit_tenantId_salesAgentId_checkInAt_idx" ON "Visit"("tenantId", "salesAgentId", "checkInAt");

-- CreateIndex
CREATE INDEX "Attendance_tenantId_idx" ON "Attendance"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_salesAgentId_date_key" ON "Attendance"("salesAgentId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Delivery_orderId_key" ON "Delivery"("orderId");

-- CreateIndex
CREATE INDEX "Delivery_tenantId_deliveryAgentId_idx" ON "Delivery"("tenantId", "deliveryAgentId");

-- CreateIndex
CREATE INDEX "OtpChallenge_tenantId_phone_createdAt_idx" ON "OtpChallenge"("tenantId", "phone", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_entity_entityId_idx" ON "AuditLog"("tenantId", "entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "TenantDomain" ADD CONSTRAINT "TenantDomain_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Region" ADD CONSTRAINT "Region_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Area" ADD CONSTRAINT "Area_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Area" ADD CONSTRAINT "Area_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailerProfile" ADD CONSTRAINT "RetailerProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailerProfile" ADD CONSTRAINT "RetailerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailerProfile" ADD CONSTRAINT "RetailerProfile_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetailerProfile" ADD CONSTRAINT "RetailerProfile_salesAgentId_fkey" FOREIGN KEY ("salesAgentId") REFERENCES "SalesAgentProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesAgentProfile" ADD CONSTRAINT "SalesAgentProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesAgentProfile" ADD CONSTRAINT "SalesAgentProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Beat" ADD CONSTRAINT "Beat_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Beat" ADD CONSTRAINT "Beat_salesAgentId_fkey" FOREIGN KEY ("salesAgentId") REFERENCES "SalesAgentProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Beat" ADD CONSTRAINT "Beat_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryAgentProfile" ADD CONSTRAINT "DeliveryAgentProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryAgentProfile" ADD CONSTRAINT "DeliveryAgentProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_retailerId_fkey" FOREIGN KEY ("retailerId") REFERENCES "RetailerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStatusEvent" ADD CONSTRAINT "OrderStatusEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStatusEvent" ADD CONSTRAINT "OrderStatusEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStatusEvent" ADD CONSTRAINT "OrderStatusEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_salesAgentId_fkey" FOREIGN KEY ("salesAgentId") REFERENCES "SalesAgentProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_retailerId_fkey" FOREIGN KEY ("retailerId") REFERENCES "RetailerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_salesAgentId_fkey" FOREIGN KEY ("salesAgentId") REFERENCES "SalesAgentProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_deliveryAgentId_fkey" FOREIGN KEY ("deliveryAgentId") REFERENCES "DeliveryAgentProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OtpChallenge" ADD CONSTRAINT "OtpChallenge_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Counter" ADD CONSTRAINT "Counter_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Row-level security: tenant isolation ───
-- Rows are visible/writable only when app.tenant_id (set per transaction by
-- src/lib/db.ts) matches. Platform jobs may set app.bypass_rls = 'on'.
-- FORCE makes the policies apply to the table owner (the app role) too.
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "User" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "Region" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Region" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Region" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "Area" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Area" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Area" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "RetailerProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RetailerProfile" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RetailerProfile" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "SalesAgentProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SalesAgentProfile" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SalesAgentProfile" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "Beat" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Beat" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Beat" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "DeliveryAgentProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeliveryAgentProfile" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DeliveryAgentProfile" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "Product" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Product" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Product" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "Order" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Order" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Order" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "OrderItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrderItem" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "OrderItem" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "OrderStatusEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrderStatusEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "OrderStatusEvent" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "Visit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Visit" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Visit" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "Attendance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Attendance" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Attendance" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "Delivery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Delivery" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Delivery" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "OtpChallenge" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OtpChallenge" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "OtpChallenge" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "Counter" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Counter" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Counter" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');

-- Audit log is append-only: read and insert, never update or delete.
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_read ON "AuditLog" FOR SELECT USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
CREATE POLICY audit_insert ON "AuditLog" FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
