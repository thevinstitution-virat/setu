import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { asPlatform } from "@/lib/db";
import { platformDomain } from "@/lib/tenant";
import { addDomain, DomainError, domainView, MAX_DOMAINS } from "@/lib/domains";

/** The business's own web addresses (customDomain module). */
export async function GET() {
  const auth = await guard("settings.manage");
  if (!auth.ok) return auth.res;
  const rows = await asPlatform((tx) => tx.tenantDomain.findMany({ where: { tenantId: auth.tenant.id }, orderBy: { createdAt: "asc" } }));
  return NextResponse.json({ max: MAX_DOMAINS, defaultHost: `${auth.tenant.slug}.${platformDomain()}`, domains: rows.map((d) => domainView(d, auth.tenant.slug)) });
}

/** Body: { host } → the DNS records to add. */
export async function POST(req: Request) {
  const auth = await guard("settings.manage");
  if (!auth.ok) return auth.res;
  const body = await req.json().catch(() => null);
  try {
    const d = await addDomain(auth.tenant.id, String(body?.host ?? ""));
    await audit(auth.db, { actorId: auth.session.userId, action: "domain.add", entity: "TenantDomain", entityId: d.id, after: { host: d.host }, ip: requestIp(req) });
    return NextResponse.json(domainView(d, auth.tenant.slug), { status: 201 });
  } catch (e) {
    if (e instanceof DomainError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
