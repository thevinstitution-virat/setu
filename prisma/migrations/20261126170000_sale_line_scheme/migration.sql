-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "dealBuy" INTEGER,
ADD COLUMN     "dealForItemId" TEXT,
ADD COLUMN     "dealGet" INTEGER,
ADD COLUMN     "extraScheme" INTEGER NOT NULL DEFAULT 0;

-- The office's scheme is an amount off the line; a deal has both sides, each at least 1.
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_extra_scheme" CHECK ("extraScheme" >= 0);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_deal" CHECK (("dealBuy" IS NULL AND "dealGet" IS NULL) OR ("dealBuy" >= 1 AND "dealGet" >= 1));
