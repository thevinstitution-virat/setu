import { NextResponse } from "next/server";
import { noticeCode } from "@/lib/login-notices";
import { getTenant } from "@/lib/tenant";
import { localRedirect } from "@/lib/redirect";
import { finishSignIn } from "@/lib/mfa";
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
    // The new owner sets up the authenticator app first, then lands on the checklist.
    const next = await finishSignIn(tenant.id, user.id, "welcome", { next: "/admin/setup" });
    await audit(tenantDb(tenant.id), { actorId: user.id, action: "auth.welcome", entity: "User", entityId: user.id, ip: requestIp(req) });
    return localRedirect(next);
  } catch (e) {
    if (e instanceof SignupError) return localRedirect(`/login?notice=${noticeCode(e.message, "welcome")}`);
    throw e;
  }
}
