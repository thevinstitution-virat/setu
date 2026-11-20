import { NextResponse } from "next/server";
import { asPlatform } from "@/lib/db";
import { platformGuard } from "@/lib/platform-auth";
import { usagePeriod } from "@/lib/billing";

/**
 * Usage and AI cost per business for a month. ?period=YYYY-MM (default: this month).
 * Metrics: ai_credits (with provider cost), messages (SMS / WhatsApp sent), api_calls.
 */
export async function GET(req: Request) {
  const g = await platformGuard();
  if (!g.ok) return g.res;
  const p = new URL(req.url).searchParams.get("period");
  const period = p && /^\d{4}-\d{2}$/.test(p) ? p : usagePeriod(new Date());
  const rows = await asPlatform((tx) => tx.usageCounter.findMany({ where: { period }, include: { tenant: { select: { name: true, slug: true, plan: true } } } }));
  const byTenant = new Map<string, { tenantId: string; name: string; slug: string; plan: string; metrics: Record<string, number>; costPaise: number }>();
  for (const r of rows) {
    const t = byTenant.get(r.tenantId) ?? { tenantId: r.tenantId, name: r.tenant.name, slug: r.tenant.slug, plan: r.tenant.plan, metrics: {}, costPaise: 0 };
    t.metrics[r.metric] = (t.metrics[r.metric] ?? 0) + r.value;
    t.costPaise += r.costPaise;
    byTenant.set(r.tenantId, t);
  }
  const list = [...byTenant.values()].sort((a, b) => b.costPaise - a.costPaise || (b.metrics.messages ?? 0) - (a.metrics.messages ?? 0));
  const totals = list.reduce(
    (s, t) => {
      for (const [k, v] of Object.entries(t.metrics)) s.metrics[k] = (s.metrics[k] ?? 0) + v;
      s.costPaise += t.costPaise;
      return s;
    },
    { metrics: {} as Record<string, number>, costPaise: 0 }
  );
  return NextResponse.json({ period, tenants: list, totals });
}
