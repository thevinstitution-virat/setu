-- A shop that pays against named bills only: receipts wait on account until tagged.
ALTER TABLE "RetailerProfile" ADD COLUMN "receiptsOnAccount" BOOLEAN NOT NULL DEFAULT false;
