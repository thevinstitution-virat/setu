-- Soft credit limit: a hold past the real limit needs the owner.
ALTER TABLE "Order" ADD COLUMN "creditHoldOwner" BOOLEAN NOT NULL DEFAULT false;

-- A credit limit per salesman, on what their shops owe.
ALTER TABLE "SalesAgentProfile" ADD COLUMN "creditLimit" INTEGER;
ALTER TABLE "SalesAgentProfile" ADD CONSTRAINT "SalesAgentProfile_credit_limit" CHECK ("creditLimit" IS NULL OR "creditLimit" >= 0);
