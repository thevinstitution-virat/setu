-- An invoice without GST (no platform GSTIN yet) has no tax at all: the first
-- check refused it. Inter-state = IGST only; within the state = CGST + SGST only.
ALTER TABLE "PlatformInvoice" DROP CONSTRAINT "PlatformInvoice_amounts_valid";
ALTER TABLE "PlatformInvoice" ADD CONSTRAINT "PlatformInvoice_amounts_valid" CHECK (
  "taxable" >= 0 AND "cgst" >= 0 AND "sgst" >= 0 AND "igst" >= 0
  AND "total" = "taxable" + "cgst" + "sgst" + "igst"
  AND (NOT "interState" OR ("cgst" = 0 AND "sgst" = 0))
  AND ("interState" OR "igst" = 0)
);
