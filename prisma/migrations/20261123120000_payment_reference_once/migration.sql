-- A UPI or bank reference (UTR) pays for one thing only. The routes already
-- look for an earlier use, but two requests at the same moment could both pass
-- that look and credit the money twice (security report 23 Nov, finding 3).
-- Rejected and reversed payments free the reference again.
CREATE UNIQUE INDEX "Payment_reference_used_once" ON "Payment"("tenantId", "reference")
  WHERE "method" IN ('UPI', 'BANK')
    AND "state" IN ('PENDING_VERIFICATION', 'CONFIRMED')
    AND "reference" IS NOT NULL;
