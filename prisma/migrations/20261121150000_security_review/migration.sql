-- Security review (21 Nov): delivery-code tries counted atomically; per-user session version to end sessions.
ALTER TABLE "Delivery" ADD COLUMN "codeTries" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
