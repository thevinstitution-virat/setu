import { NextResponse } from "next/server";
import { getTenant } from "@/lib/tenant";
import { tenantDb, withTenantTx } from "@/lib/db";
import { requestIp } from "@/lib/audit";
import { checkKey } from "@/lib/api-keys";
import { getResource, listResource, RESOURCES } from "@/lib/public-api";

type P = { params: Promise<{ path: string[] }> };

/**
 * Read-only API for the business's own software, on its own address:
 *   GET /api/v1/{retailers|products|orders|invoices|payments|stock}[?limit&cursor&updated_since]
 *   GET /api/v1/{retailers|products|orders|invoices|payments}/{id}
 * Authorization: Bearer setu_… (made in Admin → Integrations).
 */
export async function GET(req: Request, { params }: P) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: "Unknown business address" }, { status: 404 });
  const { path } = await params;
  const [resource, id, extra] = path;
  const scope = RESOURCES[resource];
  if (!scope || extra || (id && resource === "stock")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const check = await checkKey(tenantDb(tenant.id), req, scope, requestIp(req));
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
  const headers = { "Cache-Control": "no-store" };
  if (id) {
    const one = await withTenantTx(tenant.id, (tx) => getResource(tx, resource, id));
    return one ? NextResponse.json({ data: one }, { headers }) : NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const r = await withTenantTx(tenant.id, (tx) => listResource(tx, resource, new URL(req.url).searchParams));
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r, { headers });
}
