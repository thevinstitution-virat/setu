-- Phase 12: supplier lead time for forecast reorder suggestions (A6).
ALTER TABLE "Supplier" ADD COLUMN     "leadDays" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_leadDays_check" CHECK ("leadDays" BETWEEN 0 AND 90);
