-- CreateEnum
CREATE TYPE "VisitOutcome" AS ENUM ('ORDER', 'NO_ORDER');

-- CreateEnum
CREATE TYPE "LeaveStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TargetMetric" AS ENUM ('VALUE', 'VOLUME', 'NEW_OUTLETS', 'COLLECTION');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'SUPERVISOR';

-- DropForeignKey
ALTER TABLE "Attendance" DROP CONSTRAINT "Attendance_salesAgentId_fkey";

-- DropIndex
DROP INDEX "Attendance_salesAgentId_date_key";

-- DropIndex
DROP INDEX "Attendance_tenantId_idx";

-- (StockLot_place_batch_key is hand-written in 20261119060500_inventory_security; keep it.)

-- Attendance moves from sales agents to users (every field role); keep existing days.
ALTER TABLE "Attendance" ADD COLUMN "userId" TEXT;
UPDATE "Attendance" a SET "userId" = s."userId" FROM "SalesAgentProfile" s WHERE s."id" = a."salesAgentId";
DELETE FROM "Attendance" WHERE "userId" IS NULL;
ALTER TABLE "Attendance" ALTER COLUMN "userId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Attendance" DROP COLUMN "salesAgentId",
ADD COLUMN     "checkInAccuracy" INTEGER,
ADD COLUMN     "checkInSelfie" TEXT,
ADD COLUMN     "checkOutAccuracy" INTEGER,
ADD COLUMN     "checkOutLat" DOUBLE PRECISION,
ADD COLUMN     "checkOutLng" DOUBLE PRECISION,
ADD COLUMN     "checkOutSelfie" TEXT,
ADD COLUMN     "distanceM" INTEGER,
ADD COLUMN     "late" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "minutes" INTEGER,
ADD COLUMN     "note" TEXT;

-- AlterTable
ALTER TABLE "Beat" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- AlterTable
ALTER TABLE "RetailerProfile" ADD COLUMN     "fssai" TEXT,
ADD COLUMN     "photoKey" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "supervisorId" TEXT;

-- AlterTable
ALTER TABLE "Visit" ADD COLUMN     "beatPlanId" TEXT,
ADD COLUMN     "checkInAccuracy" INTEGER,
ADD COLUMN     "checkOutLat" DOUBLE PRECISION,
ADD COLUMN     "checkOutLng" DOUBLE PRECISION,
ADD COLUMN     "distanceM" INTEGER,
ADD COLUMN     "noOrderReason" TEXT,
ADD COLUMN     "offBeat" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "outcome" "VisitOutcome",
ADD COLUMN     "photoKey" TEXT;

-- CreateTable
CREATE TABLE "BeatRetailer" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "beatId" TEXT NOT NULL,
    "retailerId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BeatRetailer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BeatPlan" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "salesAgentId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "beatId" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BeatPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocationPing" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "userId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "accuracy" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'app',
    "battery" INTEGER,

    CONSTRAINT "LocationPing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "userId" TEXT NOT NULL,
    "fromDate" TEXT NOT NULL,
    "toDate" TEXT NOT NULL,
    "days" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "reason" TEXT,
    "status" "LeaveStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreLead" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "outletName" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "gstin" TEXT,
    "fssai" TEXT,
    "shopNumber" TEXT NOT NULL,
    "complexName" TEXT NOT NULL,
    "pinCode" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "accuracy" INTEGER,
    "photoKey" TEXT,
    "note" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'PENDING',
    "createdById" TEXT NOT NULL,
    "salesAgentId" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "retailerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Target" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "userId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "metric" "TargetMetric" NOT NULL,
    "goal" INTEGER NOT NULL,
    "productId" TEXT,
    "brandId" TEXT,
    "incentive" INTEGER NOT NULL DEFAULT 0,
    "minPct" INTEGER NOT NULL DEFAULT 80,
    "capPct" INTEGER NOT NULL DEFAULT 120,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Target_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HandoffUse" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "userId" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HandoffUse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BeatRetailer_tenantId_retailerId_idx" ON "BeatRetailer"("tenantId", "retailerId");

-- CreateIndex
CREATE UNIQUE INDEX "BeatRetailer_beatId_retailerId_key" ON "BeatRetailer"("beatId", "retailerId");

-- CreateIndex
CREATE INDEX "BeatPlan_tenantId_date_idx" ON "BeatPlan"("tenantId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "BeatPlan_tenantId_salesAgentId_date_key" ON "BeatPlan"("tenantId", "salesAgentId", "date");

-- CreateIndex
CREATE INDEX "LocationPing_tenantId_userId_at_idx" ON "LocationPing"("tenantId", "userId", "at");

-- CreateIndex
CREATE INDEX "LocationPing_tenantId_at_idx" ON "LocationPing"("tenantId", "at");

-- CreateIndex
CREATE INDEX "LeaveRequest_tenantId_userId_fromDate_idx" ON "LeaveRequest"("tenantId", "userId", "fromDate");

-- CreateIndex
CREATE INDEX "LeaveRequest_tenantId_status_idx" ON "LeaveRequest"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StoreLead_retailerId_key" ON "StoreLead"("retailerId");

-- CreateIndex
CREATE INDEX "StoreLead_tenantId_status_idx" ON "StoreLead"("tenantId", "status");

-- CreateIndex
CREATE INDEX "StoreLead_tenantId_createdById_createdAt_idx" ON "StoreLead"("tenantId", "createdById", "createdAt");

-- CreateIndex
CREATE INDEX "Target_tenantId_period_idx" ON "Target"("tenantId", "period");

-- CreateIndex
CREATE INDEX "Target_tenantId_userId_period_idx" ON "Target"("tenantId", "userId", "period");

-- CreateIndex
CREATE INDEX "HandoffUse_tenantId_usedAt_idx" ON "HandoffUse"("tenantId", "usedAt");

-- CreateIndex
CREATE INDEX "Attendance_tenantId_date_idx" ON "Attendance"("tenantId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_tenantId_userId_date_key" ON "Attendance"("tenantId", "userId", "date");

-- CreateIndex
CREATE INDEX "Beat_tenantId_salesAgentId_idx" ON "Beat"("tenantId", "salesAgentId");

-- CreateIndex
CREATE INDEX "User_tenantId_supervisorId_idx" ON "User"("tenantId", "supervisorId");

-- CreateIndex
CREATE INDEX "Visit_tenantId_retailerId_checkInAt_idx" ON "Visit"("tenantId", "retailerId", "checkInAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BeatRetailer" ADD CONSTRAINT "BeatRetailer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BeatRetailer" ADD CONSTRAINT "BeatRetailer_beatId_fkey" FOREIGN KEY ("beatId") REFERENCES "Beat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BeatRetailer" ADD CONSTRAINT "BeatRetailer_retailerId_fkey" FOREIGN KEY ("retailerId") REFERENCES "RetailerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BeatPlan" ADD CONSTRAINT "BeatPlan_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BeatPlan" ADD CONSTRAINT "BeatPlan_salesAgentId_fkey" FOREIGN KEY ("salesAgentId") REFERENCES "SalesAgentProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BeatPlan" ADD CONSTRAINT "BeatPlan_beatId_fkey" FOREIGN KEY ("beatId") REFERENCES "Beat"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BeatPlan" ADD CONSTRAINT "BeatPlan_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_beatPlanId_fkey" FOREIGN KEY ("beatPlanId") REFERENCES "BeatPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationPing" ADD CONSTRAINT "LocationPing_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationPing" ADD CONSTRAINT "LocationPing_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreLead" ADD CONSTRAINT "StoreLead_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreLead" ADD CONSTRAINT "StoreLead_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreLead" ADD CONSTRAINT "StoreLead_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreLead" ADD CONSTRAINT "StoreLead_salesAgentId_fkey" FOREIGN KEY ("salesAgentId") REFERENCES "SalesAgentProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreLead" ADD CONSTRAINT "StoreLead_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreLead" ADD CONSTRAINT "StoreLead_retailerId_fkey" FOREIGN KEY ("retailerId") REFERENCES "RetailerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Target" ADD CONSTRAINT "Target_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Target" ADD CONSTRAINT "Target_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandoffUse" ADD CONSTRAINT "HandoffUse_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ───── Phase 6 security and integrity (hand-written) ─────
ALTER TABLE "BeatRetailer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BeatRetailer" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "BeatRetailer" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "BeatPlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BeatPlan" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "BeatPlan" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "LocationPing" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LocationPing" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "LocationPing" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "LeaveRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeaveRequest" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "LeaveRequest" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "StoreLead" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StoreLead" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "StoreLead" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "Target" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Target" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Target" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "HandoffUse" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HandoffUse" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "HandoffUse" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');

ALTER TABLE "Beat" ADD CONSTRAINT "Beat_weekdays_check" CHECK ("weekdays" <@ ARRAY[0,1,2,3,4,5,6]);
ALTER TABLE "Target" ADD CONSTRAINT "Target_numbers_check" CHECK ("goal" > 0 AND "incentive" >= 0 AND "minPct" BETWEEN 0 AND 100 AND "capPct" >= 100 AND "capPct" <= 1000);
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_dates_check" CHECK ("days" > 0 AND "toDate" >= "fromDate");
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_no_order_reason_check" CHECK ("outcome" IS DISTINCT FROM 'NO_ORDER' OR "noOrderReason" IS NOT NULL);
ALTER TABLE "LocationPing" ADD CONSTRAINT "LocationPing_position_check" CHECK ("lat" BETWEEN -90 AND 90 AND "lng" BETWEEN -180 AND 180);

-- One target per person, month, metric and product / brand.
-- The always-true WHERE makes these partial indexes, which Prisma leaves alone (no false drift in CI).
CREATE UNIQUE INDEX "Target_one_per_metric_key" ON "Target"("tenantId", "userId", "period", "metric", "productId", "brandId") NULLS NOT DISTINCT WHERE "tenantId" IS NOT NULL;
DROP INDEX "StockLot_place_batch_key";
CREATE UNIQUE INDEX "StockLot_place_batch_key" ON "StockLot" ("tenantId", "locationId", "productId", "batch", "expiry") NULLS NOT DISTINCT WHERE "tenantId" IS NOT NULL;
