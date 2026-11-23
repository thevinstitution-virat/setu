-- The business owner: the admin who signed the business up (Team rules + console).
ALTER TABLE "User" ADD COLUMN     "isOwner" BOOLEAN NOT NULL DEFAULT false;

-- Each business's first real admin becomes its owner.
-- (User has FORCE row-level security; the app's own bypass switch, this migration's connection only.)
SELECT set_config('app.bypass_rls', 'on', false);
UPDATE "User" u SET "isOwner" = true
FROM (
  SELECT DISTINCT ON ("tenantId") id FROM "User"
  WHERE role = 'ADMIN' AND "isSupport" = false
  ORDER BY "tenantId", "createdAt", id
) first_admin
WHERE u.id = first_admin.id;

-- One owner per business.
CREATE UNIQUE INDEX "User_one_owner_per_business" ON "User"("tenantId") WHERE "isOwner";

-- One super-admin (console OWNER) on the whole platform.
CREATE UNIQUE INDEX "PlatformUser_one_owner" ON "PlatformUser"("role") WHERE "role" = 'OWNER';
