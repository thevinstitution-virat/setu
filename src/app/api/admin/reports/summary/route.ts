import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { withTenantTx } from "@/lib/db";
import { dailySummary } from "@/lib/analytics";
import { sendDailySummary } from "@/lib/daily-summary";
import { reportSettings } from "@/lib/report-settings";
import { istDay } from "@/lib/field-math";

/** GET → today's summary figures and the summary settings (a preview of the evening message). */
export async function GET() {
  const auth = await guard("reports.view");
  if (!auth.ok) return auth.res;
  const out = await withTenantTx(auth.tenant.id, async (tx) => {
    const t = await tx.tenant.findUniqueOrThrow({ where: { id: auth.tenant.id }, select: { settings: true } });
    return { settings: reportSettings(t.settings), today: await dailySummary(tx, istDay()) };
  });
  return NextResponse.json(out, { headers: { "cache-control": "no-store" } });
}

/** POST → send today's summary to the owners now (in the app, push and WhatsApp as set in Messages). */
export async function POST(req: Request) {
  const auth = await guard("settings.manage");
  if (!auth.ok) return auth.res;
  const r = await sendDailySummary(auth.tenant.id, new Date(), { force: true });
  await audit(auth.db, { actorId: auth.session.userId, action: "report.summary_sent", entity: "Tenant", entityId: auth.tenant.id, after: { result: r }, ip: requestIp(req) });
  if (r === "nobody") return NextResponse.json({ error: "There is no active owner account to send it to" }, { status: 409 });
  return NextResponse.json({ ok: true });
}
