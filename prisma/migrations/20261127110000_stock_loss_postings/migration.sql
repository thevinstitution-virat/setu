-- Stock losses shown in the books (T3): damage, expiry, write-offs and manual
-- adjustments post their cost between Purchases and Stock loss.
ALTER TYPE "EntryKind" ADD VALUE 'STOCK_MOVE';

ALTER TABLE "StockMove" ADD COLUMN "entryId" TEXT;
ALTER TABLE "StockMove" ADD COLUMN "bookValue" INTEGER;
CREATE INDEX "StockMove_tenantId_entryId_idx" ON "StockMove"("tenantId", "entryId");

-- The account now holds damage and expiry too, not only count shortages
-- (every business: row level security is set aside for this one update).
SELECT set_config('app.bypass_rls', 'on', true);
UPDATE "LedgerAccount" SET "name" = 'Stock loss and shortage' WHERE "type" = 'STOCK_LOSS' AND "name" = 'Stock shortage';
SELECT set_config('app.bypass_rls', 'off', true);
