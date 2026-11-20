import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { asPlatform } from "@/lib/db";
import { tenantUrl } from "@/lib/notify";
import { ALL_SCOPES, MAX_KEYS, RATE_PER_MINUTE, SCOPES } from "@/lib/api-keys";
import { BACKOFF_MINUTES, DISABLE_AFTER, MAX_ENDPOINTS, WEBHOOK_EVENTS } from "@/lib/webhooks";
import { locateShops, mapsStatus } from "@/lib/maps";

/** Admin → Integrations: API keys, webhooks and the maps provider in one view. */
export async function GET() {
  const auth = await guard("integrations.manage");
  if (!auth.ok) return auth.res;
  const { db, tenant } = auth;
  const since = new Date(Date.now() - 7 * 24 * 3600_000);
  const [keys, endpoints, stats, unpinned, shops] = await Promise.all([
    db.apiKey.findMany({ orderBy: { createdAt: "desc" }, select: { id: true, name: true, prefix: true, scopes: true, lastUsedAt: true, lastUsedIp: true, revokedAt: true, createdAt: true, createdBy: { select: { name: true } } } }),
    db.webhookEndpoint.findMany({ orderBy: { createdAt: "desc" }, select: { id: true, url: true, description: true, events: true, active: true, failStreak: true, disabledReason: true, createdAt: true } }),
    db.webhookDelivery.groupBy({ by: ["endpointId", "status"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    db.retailerProfile.count({ where: { lat: null } }),
    db.retailerProfile.count(),
  ]);
  const byEndpoint = new Map<string, Record<string, number>>();
  for (const s of stats) byEndpoint.set(s.endpointId, { ...(byEndpoint.get(s.endpointId) ?? {}), [s.status]: s._count._all });
  const base = await asPlatform((tx) => tenantUrl(tx, tenant.id, "/api/v1"));
  return NextResponse.json({
    api: { base, scopes: SCOPES, allScopes: ALL_SCOPES, ratePerMinute: RATE_PER_MINUTE, maxKeys: MAX_KEYS },
    keys: keys.map((k) => ({ ...k, createdBy: k.createdBy.name, hint: `setu_${k.prefix}_…` })),
    webhooks: { events: WEBHOOK_EVENTS, backoffMinutes: BACKOFF_MINUTES, disableAfter: DISABLE_AFTER, maxEndpoints: MAX_ENDPOINTS, endpoints: endpoints.map((e) => ({ ...e, last7Days: byEndpoint.get(e.id) ?? {} })) },
    maps: { ...mapsStatus(), shops, unpinned },
  });
}

/** Body: { action: "locate" } — find map pins for shops without one (up to 50 now). */
export async function POST(req: Request) {
  const auth = await guard("integrations.manage");
  if (!auth.ok) return auth.res;
  const { session, db, tenant } = auth;
  const body = (await req.json().catch(() => null)) as { action?: string } | null;
  if (body?.action !== "locate") return NextResponse.json({ error: "Action is locate" }, { status: 400 });
  const r = await locateShops(tenant.id, undefined, 50);
  if (r.provider === "none") return NextResponse.json({ error: "No maps provider is set up, so addresses cannot be looked up" }, { status: 409 });
  await audit(db, { actorId: session.userId, action: "maps.locate", entity: "RetailerProfile", after: r, ip: requestIp(req) });
  return NextResponse.json(r);
}
