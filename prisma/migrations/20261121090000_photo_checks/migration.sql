-- CreateTable
CREATE TABLE "PhotoCheck" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "result" JSONB NOT NULL DEFAULT '{}',
    "credits" INTEGER NOT NULL DEFAULT 0,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhotoCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShelfAudit" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "retailerId" TEXT NOT NULL,
    "visitId" TEXT,
    "byId" TEXT NOT NULL,
    "photoKey" TEXT NOT NULL,
    "ours" INTEGER NOT NULL,
    "others" INTEGER NOT NULL,
    "empty" INTEGER NOT NULL,
    "seen" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source" TEXT NOT NULL DEFAULT 'manual',
    "read" JSONB,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShelfAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PhotoCheck_tenantId_hash_idx" ON "PhotoCheck"("tenantId", "hash");

-- CreateIndex
CREATE UNIQUE INDEX "PhotoCheck_tenantId_subjectType_subjectId_fileKey_key" ON "PhotoCheck"("tenantId", "subjectType", "subjectId", "fileKey");

-- CreateIndex
CREATE INDEX "ShelfAudit_tenantId_retailerId_createdAt_idx" ON "ShelfAudit"("tenantId", "retailerId", "createdAt");

-- CreateIndex
CREATE INDEX "ShelfAudit_tenantId_createdAt_idx" ON "ShelfAudit"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "PhotoCheck" ADD CONSTRAINT "PhotoCheck_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShelfAudit" ADD CONSTRAINT "ShelfAudit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShelfAudit" ADD CONSTRAINT "ShelfAudit_retailerId_fkey" FOREIGN KEY ("retailerId") REFERENCES "RetailerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShelfAudit" ADD CONSTRAINT "ShelfAudit_byId_fkey" FOREIGN KEY ("byId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Counts are whole numbers a shelf can hold; verdicts and sources from a short list.
ALTER TABLE "ShelfAudit" ADD CONSTRAINT "ShelfAudit_counts_check" CHECK ("ours" BETWEEN 0 AND 1000 AND "others" BETWEEN 0 AND 1000 AND "empty" BETWEEN 0 AND 1000);
ALTER TABLE "ShelfAudit" ADD CONSTRAINT "ShelfAudit_source_check" CHECK ("source" IN ('manual', 'ai', 'ai_edited'));
ALTER TABLE "PhotoCheck" ADD CONSTRAINT "PhotoCheck_verdict_check" CHECK ("verdict" IN ('ok', 'warn', 'bad'));
ALTER TABLE "PhotoCheck" ADD CONSTRAINT "PhotoCheck_source_check" CHECK ("source" IN ('rules', 'ai'));

-- Row-level security
ALTER TABLE "PhotoCheck" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PhotoCheck" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PhotoCheck" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');

-- Row-level security
ALTER TABLE "ShelfAudit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ShelfAudit" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ShelfAudit" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
