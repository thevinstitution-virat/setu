import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { withTenantTx } from "@/lib/db";
import { DAILY, runFeature, type Feature } from "@/lib/automation";
import { automationSettings } from "@/lib/automation-settings";
import { usagePeriod } from "@/lib/billing";
import { aiConfig, aiStatus } from "@/lib/ai";
import { aiSettings } from "@/lib/ai-settings";

const FEATURES: Feature[] = ["visit_plan", "collections", "checks", "credit", "reorder", "expire"];

/** GET → automation settings, the last runs, open suggestions by kind and this month's AI use. */
export async function GET() {
  const auth = await guard("settings.manage");
  if (!auth.ok) return auth.res;
  const status = await aiStatus(auth.tenant.id);
  const out = await withTenantTx(auth.tenant.id, async (tx) => {
    const [t, runs, open, ai] = await Promise.all([
      tx.tenant.findUniqueOrThrow({ where: { id: auth.tenant.id }, select: { settings: true } }),
      tx.automationRun.findMany({ orderBy: { startedAt: "desc" }, take: 30 }),
      tx.suggestion.groupBy({ by: ["kind"], where: { status: "OPEN" }, _count: { _all: true } }),
      tx.usageCounter.findFirst({ where: { period: usagePeriod(new Date()), metric: "ai_credits" }, select: { value: true, costPaise: true } }),
    ]);
    return {
      settings: automationSettings(t.settings),
      runs,
      open: Object.fromEntries(open.map((o) => [o.kind, o._count._all])),
      ai: {
        credits: ai?.value ?? 0,
        costPaise: ai?.costPaise ?? 0,
        settings: aiSettings(t.settings),
        available: status.available,
        message: status.available ? null : status.message,
        model: status.available ? status.model : aiConfig().provider === "none" ? null : aiConfig().model,
      },
    };
  });
  return NextResponse.json(out, { headers: { "cache-control": "no-store" } });
}

/** POST { feature?: one of FEATURES | "all" } → run it now for this business ("all" = the daily set and the credit review). */
export async function POST(req: Request) {
  const auth = await guard("settings.manage");
  if (!auth.ok) return auth.res;
  const b = (await req.json().catch(() => ({}))) as { feature?: unknown };
  const f = b.feature ?? "all";
  if (f !== "all" && !FEATURES.includes(f as Feature)) return NextResponse.json({ error: "Unknown automation" }, { status: 400 });
  const list: Feature[] = f === "all" ? [...DAILY, "credit"] : [f as Feature];
  const results = [];
  for (const x of list) results.push(await runFeature(auth.tenant.id, x, "manual"));
  await audit(auth.db, { actorId: auth.session.userId, action: "automation.run", entity: "Tenant", entityId: auth.tenant.id, after: { results }, ip: requestIp(req) });
  return NextResponse.json({ results });
}
