-- A7: opening the books (switch date, opening stock, the opening balances entry).
ALTER TABLE "Tenant" ADD COLUMN     "booksStartOn" DATE,
ADD COLUMN     "openingEntryId" TEXT,
ADD COLUMN     "openingStock" BIGINT;

ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_openingStock_check" CHECK ("openingStock" IS NULL OR "openingStock" >= 0);
