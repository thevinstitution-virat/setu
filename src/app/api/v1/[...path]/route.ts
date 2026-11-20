import { NextResponse } from "next/server";
import { getTenant } from "@/lib/tenant";
import { tenantDb, withTenantTx } from "@/lib/db";
import { requestIp } from "@/lib/audit";
import { checkKey } from "@/lib/api-keys";
import { getResource, listResource, RESOURCES } from "@/lib/public-api";
import { hasFeature } from "@/lib/plans";
import { meter } from "@/lib/billing";

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
  if (tenant.status === "SUSPENDED") return NextResponse.json({ error: "This business is paused" }, { status: 423 });
  if (!(await hasFeature(tenant.id, "integrations"))) return NextResponse.json({ error: "The API is not in this business's plan" }, { status: 402 });
  const { path } = await params;
  const [resource, id, extra] = path;
  const scope = RESOURCES[resource];
  if (!scope || extra || (id && resource === "stock")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const check = await checkKey(tenantDb(tenant.id), req, scope, requestIp(req));
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
  await withTenantTx(tenant.id, (tx) => meter(tx, tenant.id, "api_calls")).catch(() => {});
  const headers = { "Cache-Control": "no-store" };
  if (id) {
    const one = await withTenantTx(tenant.id, (tx) => getResource(tx, resource, id));
    return one ? NextResponse.json({ data: one }, { headers }) : NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const r = await withTenantTx(tenant.id, (tx) => listResource(tx, resource, new URL(req.url).searchParams));
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r, { headers });
}
