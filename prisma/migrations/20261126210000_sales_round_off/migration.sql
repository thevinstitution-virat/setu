-- Rupee round-off on sales bills: the order freezes whether its total is
-- rounded, and both the order and the GST document keep the paise added or
-- taken off so the parts always add up to the total.
ALTER TABLE "Order" ADD COLUMN "roundTotal" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Order" ADD COLUMN "roundOff" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Invoice" ADD COLUMN "roundOff" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Order" ADD CONSTRAINT "Order_roundOff_small" CHECK ("roundOff" > -100 AND "roundOff" < 100);
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_roundOff_small" CHECK ("roundOff" > -100 AND "roundOff" < 100);

-- The invoice's parts must still add up to its total, now with the round-off.
ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_amounts_check";
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_amounts_check" CHECK (
  "taxable" >= 0 AND "cgst" >= 0 AND "sgst" >= 0 AND "igst" >= 0
  AND "total" = "taxable" + "cgst" + "sgst" + "igst" + "roundOff"
  AND ("interState" OR "igst" = 0)
  AND (NOT "interState" OR ("cgst" = 0 AND "sgst" = 0))
);
