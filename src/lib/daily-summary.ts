import { asPlatform } from "@/lib/db";
import { withMoney } from "@/lib/ledger";
import { formatINR } from "@/lib/money";
import { notify } from "@/lib/notify";
import { dailySummary } from "@/lib/analytics";
import { reportSettings } from "@/lib/report-settings";
import { istDay } from "@/lib/field-math";

const IST_MS = 330 * 60_000;

/** The IST hour (0–23) of an instant. */
export const istHour = (d: Date) => new Date(d.getTime() + IST_MS).getUTCHours();

export type SummaryResult = "sent" | "off" | "not_due" | "nobody";

/**
 * The owner's evening message for one business: today's sales, orders,
 * collections, deliveries, outstanding and orders waiting. Goes to every
 * active admin at settings.reports.summaryHour (IST); once per day (dedupe
 * key), so an hourly job and a retry never send twice. `force` sends now,
 * whatever the hour (the "Send it now" button).
 */
export async function sendDailySummary(tenantId: string, now = new Date(), opts: { force?: boolean } = {}): Promise<SummaryResult> {
  return withMoney(tenantId, null, async (ctx) => {
    const t = await ctx.tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { settings: true } });
    const s = reportSettings(t.settings);
    if (!opts.force) {
      if (!s.dailySummary) return "off";
      if (istHour(now) !== s.summaryHour) return "not_due";
    }
    const admins = await ctx.tx.user.findMany({ where: { role: "ADMIN", active: true }, select: { id: true } });
    if (!admins.length) return "nobody";
    const day = istDay(now);
    const d = await dailySummary(ctx.tx, day, now);
    const rs = (p: number) => formatINR(p, { whole: true });
    await notify(ctx.tx, tenantId, {
      event: "staff.daily_summary",
      to: admins.map((a) => a.id),
      vars: {
        day: new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }),
        sales: rs(d.sales),
        orders: d.orders,
        orderValue: rs(d.orderValue),
        collected: rs(d.collected),
        cash: rs(d.cash),
        delivered: d.delivered,
        failed: d.failed,
        outstanding: rs(d.outstanding),
        overdue: rs(d.overdue),
        waiting: d.waiting,
      },
      link: "/admin/reports?preset=today",
      // A manual send gets its own key so it can be repeated; the scheduled one is once a day.
      key: opts.force ? `daily_summary:${day}:${now.getTime()}` : `daily_summary:${day}`,
    });
    return "sent";
  });
}

/** Hourly: every live business whose summary hour it is. */
export async function runDailySummaries(now = new Date()) {
  const ids = (await asPlatform((tx) => tx.tenant.findMany({ where: { status: { in: ["TRIAL", "ACTIVE"] } }, select: { id: true } }))).map((t) => t.id);
  let sent = 0;
  for (const id of ids) {
    try {
      if ((await sendDailySummary(id, now)) === "sent") sent++;
    } catch (e) {
      console.error(`[job] reports.daily_summary ${id}`, e);
    }
  }
  return { tenants: ids.length, sent };
}
