import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { checkDomain, DomainError, domainView, removeDomain } from "@/lib/domains";

/** Check the DNS records now. */
export async function POST(req: Request, ctx: RouteContext<"/api/admin/domains/[id]">) {
  const auth = await guard("settings.manage");
  if (!auth.ok) return auth.res;
  const { id } = await ctx.params;
  try {
    const d = await checkDomain(auth.tenant.id, id);
    if (d.verifiedAt) await audit(auth.db, { actorId: auth.session.userId, action: "domain.verified", entity: "TenantDomain", entityId: d.id, after: { host: d.host, tls: d.tlsStatus }, ip: requestIp(req) });
    return NextResponse.json(domainView(d, auth.tenant.slug));
  } catch (e) {
    if (e instanceof DomainError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

export async function DELETE(req: Request, ctx: RouteContext<"/api/admin/domains/[id]">) {
  const auth = await guard("settings.manage");
  if (!auth.ok) return auth.res;
  const { id } = await ctx.params;
  try {
    const d = await removeDomain(auth.tenant.id, id);
    await audit(auth.db, { actorId: auth.session.userId, action: "domain.remove", entity: "TenantDomain", entityId: d.id, before: { host: d.host }, ip: requestIp(req) });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof DomainError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
