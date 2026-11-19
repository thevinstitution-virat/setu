-- CreateEnum
CREATE TYPE "DeliveryState" AS ENUM ('ASSIGNED', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "DeliveryPref" AS ENUM ('RING_BELL', 'AT_DOOR', 'IN_HAND', 'KEEP_IN_BAG');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('PLANNED', 'STARTED', 'CLOSED');

-- AlterTable
ALTER TABLE "Delivery" ADD COLUMN     "accuracy" DOUBLE PRECISION,
ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "code" TEXT,
ADD COLUMN     "codeVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "failNote" TEXT,
ADD COLUMN     "failReason" TEXT,
ADD COLUMN     "failedAt" TIMESTAMP(3),
ADD COLUMN     "seq" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "state" "DeliveryState" NOT NULL DEFAULT 'ASSIGNED',
ADD COLUMN     "tripId" TEXT;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "deliveredQty" INTEGER,
ADD COLUMN     "orderedQty" INTEGER,
ADD COLUMN     "shortReason" TEXT;

-- AlterTable
ALTER TABLE "RetailerProfile" ADD COLUMN     "deliveryNote" TEXT,
ADD COLUMN     "deliveryPref" "DeliveryPref",
ADD COLUMN     "lat" DOUBLE PRECISION,
ADD COLUMN     "lng" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "number" TEXT NOT NULL,
    "name" TEXT,
    "capacityKg" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trip" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "number" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "slot" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "status" "TripStatus" NOT NULL DEFAULT 'PLANNED',
    "note" TEXT,
    "createdById" TEXT,
    "startedAt" TIMESTAMP(3),
    "startedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "closeSummary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Trip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Returnable" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "name" TEXT NOT NULL,
    "nameHi" TEXT,
    "unitCharge" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Returnable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnableMove" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "returnableId" TEXT NOT NULL,
    "retailerId" TEXT NOT NULL,
    "tripId" TEXT,
    "orderId" TEXT,
    "kind" TEXT NOT NULL,
    "given" INTEGER NOT NULL DEFAULT 0,
    "taken" INTEGER NOT NULL DEFAULT 0,
    "photoKey" TEXT,
    "note" TEXT,
    "billId" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReturnableMove_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DutyShift" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "userId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startLat" DOUBLE PRECISION,
    "startLng" DOUBLE PRECISION,
    "endAt" TIMESTAMP(3),
    "endLat" DOUBLE PRECISION,
    "endLng" DOUBLE PRECISION,

    CONSTRAINT "DutyShift_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_tenantId_number_key" ON "Vehicle"("tenantId", "number");

-- CreateIndex
CREATE INDEX "Trip_tenantId_date_idx" ON "Trip"("tenantId", "date");

-- CreateIndex
CREATE INDEX "Trip_tenantId_driverId_status_idx" ON "Trip"("tenantId", "driverId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Trip_tenantId_number_key" ON "Trip"("tenantId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Returnable_tenantId_name_key" ON "Returnable"("tenantId", "name");

-- CreateIndex
CREATE INDEX "ReturnableMove_tenantId_retailerId_returnableId_idx" ON "ReturnableMove"("tenantId", "retailerId", "returnableId");

-- CreateIndex
CREATE INDEX "ReturnableMove_tenantId_tripId_idx" ON "ReturnableMove"("tenantId", "tripId");

-- CreateIndex
CREATE INDEX "DutyShift_tenantId_userId_startAt_idx" ON "DutyShift"("tenantId", "userId", "startAt");

-- CreateIndex
CREATE INDEX "Delivery_tenantId_tripId_idx" ON "Delivery"("tenantId", "tripId");

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "DeliveryAgentProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Returnable" ADD CONSTRAINT "Returnable_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnableMove" ADD CONSTRAINT "ReturnableMove_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnableMove" ADD CONSTRAINT "ReturnableMove_returnableId_fkey" FOREIGN KEY ("returnableId") REFERENCES "Returnable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnableMove" ADD CONSTRAINT "ReturnableMove_retailerId_fkey" FOREIGN KEY ("retailerId") REFERENCES "RetailerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnableMove" ADD CONSTRAINT "ReturnableMove_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DutyShift" ADD CONSTRAINT "DutyShift_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───────── Phase 4: backfill, checks, row-level security ─────────

-- Deliveries made before trips existed.
UPDATE "Delivery" SET "state" = 'DELIVERED' WHERE "deliveredAt" IS NOT NULL;
UPDATE "Delivery" SET "seq" = 1 WHERE "seq" = 0;

ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_deliveredQty_check" CHECK ("deliveredQty" IS NULL OR ("deliveredQty" >= 0 AND "deliveredQty" <= COALESCE("orderedQty", "quantity")));
ALTER TABLE "ReturnableMove" ADD CONSTRAINT "ReturnableMove_counts_check" CHECK ("given" >= 0 AND "taken" >= 0);
ALTER TABLE "Returnable" ADD CONSTRAINT "Returnable_unitCharge_check" CHECK ("unitCharge" >= 0);

-- Returnable moves are history: no edits, no deletes.
CREATE OR REPLACE FUNCTION returnable_move_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Returnable moves are append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER returnable_move_guard BEFORE UPDATE OR DELETE ON "ReturnableMove"
  FOR EACH ROW EXECUTE FUNCTION returnable_move_guard();

ALTER TABLE "Vehicle" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Vehicle" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Vehicle" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "Trip" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Trip" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Trip" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "Returnable" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Returnable" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Returnable" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "ReturnableMove" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReturnableMove" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ReturnableMove" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "DutyShift" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DutyShift" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DutyShift" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
