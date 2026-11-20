import { NextResponse } from "next/server";
import { requestIp } from "@/lib/audit";
import { platformAudit, platformGuard } from "@/lib/platform-auth";
import { startSupport, SupportError } from "@/lib/support";
import { tenantAddress } from "@/lib/signup";

/** Body: { reason, mode?: READ|WRITE, minutes? } → { url } — open it to work inside the business (single use, 5 minutes). */
export async function POST(req: Request, ctx: RouteContext<"/api/platform/tenants/[id]/support">) {
  const g = await platformGuard();
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const mode = body?.mode === "WRITE" ? "WRITE" : "READ";
  if (mode === "WRITE" && g.session.role !== "OWNER") return NextResponse.json({ error: "Only the platform owner can open a session that changes things" }, { status: 403 });
  try {
    const r = await startSupport({ platformUserId: g.session.platformUserId, platformUserName: g.session.name, tenantId: id, reason: String(body?.reason ?? ""), mode, minutes: Number(body?.minutes) || 30 });
    await platformAudit(g.session.platformUserId, "support.start", { tenantId: id, detail: { sessionId: r.session.id, mode, reason: r.session.reason, until: r.session.expiresAt.toISOString() }, ip: requestIp(req) });
    return NextResponse.json({ id: r.session.id, expiresAt: r.session.expiresAt, url: tenantAddress(req.url, r.slug, `/api/auth/support?t=${encodeURIComponent(r.token)}`) }, { status: 201 });
  } catch (e) {
    if (e instanceof SupportError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
