-- Inventory (Phase 5): checks, one lot per place/product/batch/expiry, append-only history, row-level security.
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_qty_check" CHECK ("qty" >= 0);
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_unitCost_check" CHECK ("unitCost" IS NULL OR "unitCost" >= 0);
ALTER TABLE "StockMove" ADD CONSTRAINT "StockMove_qty_check" CHECK ("qty" > 0);
ALTER TABLE "StockMove" ADD CONSTRAINT "StockMove_direction_check" CHECK ("fromId" IS NOT NULL OR "toId" IS NOT NULL);
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_qty_check" CHECK ("quantity" > 0 AND "receivedQty" >= 0);
ALTER TABLE "PurchaseLine" ADD CONSTRAINT "PurchaseLine_qty_check" CHECK ("quantity" > 0);
ALTER TABLE "Product" ADD CONSTRAINT "Product_reorder_check" CHECK (("reorderLevel" IS NULL OR "reorderLevel" >= 0) AND ("reorderQty" IS NULL OR "reorderQty" > 0));
CREATE UNIQUE INDEX "StockLot_place_batch_key" ON "StockLot" ("tenantId", "locationId", "productId", "batch", "expiry") NULLS NOT DISTINCT;
-- One default warehouse per tenant.
CREATE UNIQUE INDEX "StockLocation_default_key" ON "StockLocation" ("tenantId") WHERE "isDefault";

CREATE OR REPLACE FUNCTION stock_move_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Stock moves are append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER stock_move_guard BEFORE UPDATE OR DELETE ON "StockMove"
  FOR EACH ROW EXECUTE FUNCTION stock_move_guard();

ALTER TABLE "StockLocation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StockLocation" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "StockLocation" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "StockLot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StockLot" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "StockLot" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "StockMove" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StockMove" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "StockMove" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "Supplier" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Supplier" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Supplier" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "PurchaseOrder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PurchaseOrder" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PurchaseOrder" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "PurchaseOrderLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PurchaseOrderLine" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PurchaseOrderLine" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "Purchase" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Purchase" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Purchase" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "PurchaseLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PurchaseLine" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PurchaseLine" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
