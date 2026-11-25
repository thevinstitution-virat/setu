-- Deeper credit control per retailer: a limit on the number of unpaid bills,
-- and a higher limit for a while (used until its last day).
ALTER TABLE "RetailerProfile" ADD COLUMN "creditBills" INTEGER;
ALTER TABLE "RetailerProfile" ADD COLUMN "tempCreditLimit" INTEGER;
ALTER TABLE "RetailerProfile" ADD COLUMN "tempCreditUntil" TIMESTAMP(3);

ALTER TABLE "RetailerProfile" ADD CONSTRAINT "RetailerProfile_credit_depth" CHECK (
  ("creditBills" IS NULL OR "creditBills" >= 1)
  AND ("tempCreditLimit" IS NULL OR ("tempCreditLimit" >= 0 AND "tempCreditUntil" IS NOT NULL))
);
