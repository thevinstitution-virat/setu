import { NextResponse } from "next/server";
import { requestIp } from "@/lib/audit";
import { platformAudit, platformGuard } from "@/lib/platform-auth";
import { cancelDeletion, LifecycleError, queueExport, requestDeletion } from "@/lib/tenant-data";

/** Schedule a business's deletion on its written request (OWNER). Body: { reason }. Runs after 7 days. */
export async function POST(req: Request, ctx: RouteContext<"/api/platform/tenants/[id]/deletion">) {
  const g = await platformGuard("OWNER");
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const reason = String(body?.reason ?? "").trim();
  if (reason.length < 5) return NextResponse.json({ error: "Write why (e.g. the owner's email of <date>)" }, { status: 400 });
  try {
    const r = await requestDeletion(id, `platform:${g.session.platformUserId}`);
    await queueExport(id, r.exportId);
    await platformAudit(g.session.platformUserId, "tenant.delete_requested", { tenantId: id, detail: { reason, deleteAfter: r.deleteAfter.toISOString() }, ip: requestIp(req) });
    return NextResponse.json({ ok: true, deleteAfter: r.deleteAfter });
  } catch (e) {
    if (e instanceof LifecycleError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

/** Cancel a scheduled deletion. */
export async function DELETE(req: Request, ctx: RouteContext<"/api/platform/tenants/[id]/deletion">) {
  const g = await platformGuard();
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  try {
    await cancelDeletion(id, `platform:${g.session.platformUserId}`);
    await platformAudit(g.session.platformUserId, "tenant.delete_cancelled", { tenantId: id, ip: requestIp(req) });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof LifecycleError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
