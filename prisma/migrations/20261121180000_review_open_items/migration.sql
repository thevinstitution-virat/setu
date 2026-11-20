-- Security review, open items (20 Nov 2026).

-- Custom domains: several businesses may claim an address while unverified; one verified owner per address.
DROP INDEX "TenantDomain_host_key";
ALTER TABLE "TenantDomain" ADD COLUMN     "verifiedHost" TEXT;
UPDATE "TenantDomain" SET "verifiedHost" = "host" WHERE "verifiedAt" IS NOT NULL;
CREATE UNIQUE INDEX "TenantDomain_verifiedHost_key" ON "TenantDomain"("verifiedHost");
CREATE INDEX "TenantDomain_host_idx" ON "TenantDomain"("host");
CREATE UNIQUE INDEX "TenantDomain_tenantId_host_key" ON "TenantDomain"("tenantId", "host");

-- Invoice share links: "Stop old links" bumps this.
ALTER TABLE "Invoice" ADD COLUMN     "shareVersion" INTEGER NOT NULL DEFAULT 0;

-- Platform gateway events, so a repeated or replayed one is handled once.
CREATE TABLE "PlatformWebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformWebhookEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PlatformWebhookEvent_provider_eventId_key" ON "PlatformWebhookEvent"("provider", "eventId");
