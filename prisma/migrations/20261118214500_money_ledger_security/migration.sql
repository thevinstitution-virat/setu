-- Row-level security for the money tables (same rule as every tenant table).
ALTER TABLE "LedgerAccount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LedgerAccount" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "LedgerAccount" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "Bill" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Bill" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Bill" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "Payment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Payment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Payment" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "PaymentAllocation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentAllocation" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PaymentAllocation" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "Cheque" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Cheque" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Cheque" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "CashHandover" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CashHandover" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CashHandover" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');

-- The ledger is append-only: read and insert only. Corrections are reversal entries.
ALTER TABLE "JournalEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JournalEntry" FORCE ROW LEVEL SECURITY;
CREATE POLICY ledger_read ON "JournalEntry" FOR SELECT USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
CREATE POLICY ledger_insert ON "JournalEntry" FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "LedgerLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LedgerLine" FORCE ROW LEVEL SECURITY;
CREATE POLICY ledger_read ON "LedgerLine" FOR SELECT USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
CREATE POLICY ledger_insert ON "LedgerLine" FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');

-- Double entry: the lines of every journal entry must sum to zero and be
-- non-zero. Checked at COMMIT (deferred), so an entry's lines can be inserted
-- one by one inside the transaction.
CREATE OR REPLACE FUNCTION ledger_entry_balanced() RETURNS trigger AS $$
DECLARE
  total bigint;
  n int;
BEGIN
  SELECT COALESCE(SUM(amount), 0), COUNT(*) INTO total, n
    FROM "LedgerLine" WHERE "entryId" = NEW."entryId";
  IF total <> 0 THEN
    RAISE EXCEPTION 'Journal entry % is unbalanced by % paise', NEW."entryId", total;
  END IF;
  IF n < 2 THEN
    RAISE EXCEPTION 'Journal entry % needs at least two lines', NEW."entryId";
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER ledger_entry_balanced
  AFTER INSERT ON "LedgerLine"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_entry_balanced();

ALTER TABLE "LedgerLine" ADD CONSTRAINT "LedgerLine_amount_nonzero" CHECK (amount <> 0);
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_amounts_valid" CHECK (amount > 0 AND paid >= 0 AND paid <= amount);
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amounts_valid" CHECK (amount > 0 AND allocated >= 0 AND allocated <= amount);
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_positive" CHECK (amount > 0);

