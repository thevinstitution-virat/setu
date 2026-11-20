-- PlatformAudit is our record about a business, not the business's own data:
-- a "tenantId" column would make it look tenant-owned (export, purge, the RLS check).
ALTER TABLE "PlatformAudit" RENAME COLUMN "tenantId" TO "targetTenantId";
ALTER INDEX "PlatformAudit_tenantId_createdAt_idx" RENAME TO "PlatformAudit_targetTenantId_createdAt_idx";
