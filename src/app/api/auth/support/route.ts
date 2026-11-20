import { NextResponse } from "next/server";
import { noticeCode } from "@/lib/login-notices";
import { getTenant } from "@/lib/tenant";
import { localRedirect } from "@/lib/redirect";
import { createSessionCookie } from "@/lib/auth";
import { consumeSupport, SupportError } from "@/lib/support";

/** ?t=<support token> on the business's address: open the support session (single use). */
export async function GET(req: Request) {
  const tenant = await getTenant();
  const url = new URL(req.url);
  if (!tenant) return localRedirect("/");
  try {
    const { session, user } = await consumeSupport(url.searchParams.get("t") ?? "", tenant.id);
    const seconds = Math.max(60, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000));
    await createSessionCookie({ userId: user.id, tenantId: tenant.id, role: "ADMIN", name: user.name, via: "support", supportId: session.id }, seconds);
    return localRedirect("/admin");
  } catch (e) {
    if (e instanceof SupportError) return localRedirect(`/login?notice=${noticeCode(e.message, "support")}`);
    throw e;
  }
}
