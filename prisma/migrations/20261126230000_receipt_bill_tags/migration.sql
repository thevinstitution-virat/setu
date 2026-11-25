-- A receipt can be taken against chosen bills: they are paid first, in the
-- order chosen, before anything left over goes to the oldest bills.
ALTER TABLE "Payment" ADD COLUMN "forBillIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
