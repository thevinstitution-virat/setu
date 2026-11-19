import { NextResponse } from "next/server";
import { getTenant } from "@/lib/tenant";
import { localRedirect } from "@/lib/redirect";
import { createSessionCookie } from "@/lib/auth";
import { audit, requestIp } from "@/lib/audit";
import { tenantDb } from "@/lib/db";
import { consumeWelcome, SignupError } from "@/lib/signup";

/** ?t=<welcome token> on the new business's address: sign the owner in once, open the set-up checklist. */
export async function GET(req: Request) {
  const tenant = await getTenant();
  const url = new URL(req.url);
  if (!tenant) return localRedirect("/");
  try {
    const user = await consumeWelcome(url.searchParams.get("t") ?? "", tenant.id);
    await createSessionCookie({ userId: user.id, tenantId: tenant.id, role: user.role, name: user.name, via: "welcome" });
    await audit(tenantDb(tenant.id), { actorId: user.id, action: "auth.welcome", entity: "User", entityId: user.id, ip: requestIp(req) });
    return localRedirect("/admin/setup");
  } catch (e) {
    if (e instanceof SignupError) return localRedirect(`/login?notice=${encodeURIComponent(e.message)}`);
    throw e;
  }
}
