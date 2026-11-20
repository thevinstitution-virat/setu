-- CreateEnum
CREATE TYPE "SuggestionStatus" AS ENUM ('OPEN', 'ACCEPTED', 'REJECTED', 'EXPIRED');

-- CreateTable
CREATE TABLE "Suggestion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "kind" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "reasons" JSONB NOT NULL DEFAULT '[]',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "score" INTEGER NOT NULL DEFAULT 0,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'OPEN',
    "dedupeKey" TEXT NOT NULL,
    "forDate" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "auto" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "result" JSONB,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Suggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitTask" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "salesAgentId" TEXT NOT NULL,
    "retailerId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "reasons" TEXT[],
    "note" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT 'visit_plan',
    "suggestionId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisitTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "feature" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'schedule',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "made" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "AutomationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiCostLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "feature" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costPaise" INTEGER NOT NULL DEFAULT 0,
    "credits" INTEGER NOT NULL DEFAULT 0,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiCostLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Suggestion_tenantId_status_kind_createdAt_idx" ON "Suggestion"("tenantId", "status", "kind", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Suggestion_tenantId_dedupeKey_key" ON "Suggestion"("tenantId", "dedupeKey");

-- CreateIndex
CREATE INDEX "VisitTask_tenantId_date_idx" ON "VisitTask"("tenantId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "VisitTask_tenantId_salesAgentId_retailerId_date_key" ON "VisitTask"("tenantId", "salesAgentId", "retailerId", "date");

-- CreateIndex
CREATE INDEX "AutomationRun_tenantId_startedAt_idx" ON "AutomationRun"("tenantId", "startedAt");

-- CreateIndex
CREATE INDEX "AiCostLog_tenantId_createdAt_idx" ON "AiCostLog"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "Suggestion" ADD CONSTRAINT "Suggestion_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitTask" ADD CONSTRAINT "VisitTask_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitTask" ADD CONSTRAINT "VisitTask_salesAgentId_fkey" FOREIGN KEY ("salesAgentId") REFERENCES "SalesAgentProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitTask" ADD CONSTRAINT "VisitTask_retailerId_fkey" FOREIGN KEY ("retailerId") REFERENCES "RetailerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiCostLog" ADD CONSTRAINT "AiCostLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Row-level security: each business sees only its own rows.
ALTER TABLE "Suggestion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Suggestion" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Suggestion" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "VisitTask" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VisitTask" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "VisitTask" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "AutomationRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AutomationRun" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AutomationRun" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');
ALTER TABLE "AiCostLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiCostLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AiCostLog" USING ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on') WITH CHECK ("tenantId" = current_setting('app.tenant_id', true) OR current_setting('app.bypass_rls', true) = 'on');

-- Checks.
ALTER TABLE "Suggestion" ADD CONSTRAINT "Suggestion_score_check" CHECK ("score" BETWEEN 0 AND 100);
ALTER TABLE "Suggestion" ADD CONSTRAINT "Suggestion_decided_check" CHECK (("status" = 'OPEN') = ("decidedAt" IS NULL) OR "status" = 'EXPIRED');
ALTER TABLE "VisitTask" ADD CONSTRAINT "VisitTask_date_check" CHECK ("date" ~ '^\d{4}-\d{2}-\d{2}$');
ALTER TABLE "AiCostLog" ADD CONSTRAINT "AiCostLog_amounts_check" CHECK ("inputTokens" >= 0 AND "outputTokens" >= 0 AND "costPaise" >= 0 AND "credits" >= 0);
