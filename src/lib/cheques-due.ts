import type { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db";
import { istDay, istDayRange } from "@/lib/field-math";
import { formatINR } from "@/lib/money";
import { moneySettings } from "@/lib/money-settings";
import { can } from "@/lib/permissions";
import { notify } from "@/lib/notify";

/**
 * Cheques in hand whose date has come, so they can be banked today: post-dated
 * ones that were held until their date, and ordinary ones not deposited yet.
 * A cheque whose payment was reversed or given back is closed and left out.
 */
export function bankTodayWhere(now = new Date(), opts: { heldOnly?: boolean } = {}): Prisma.ChequeWhereInput {
  const { to } = istDayRange(istDay(now));
  return {
    status: "RECEIVED",
    chequeDate: { lt: to },
    payment: { state: opts.heldOnly ? "POST_DATED" : { in: ["CONFIRMED", "POST_DATED"] } },
  };
}

/**
 * Morning reminder to whoever handles cheques: the held post-dated cheques
 * whose date has come (once a day; nothing is sent on a day with none).
 */
export async function remindChequesDue(tx: Tx, tenantId: string, now = new Date()) {
  const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { settings: true } });
  if (!moneySettings(t.settings).chequeReminder) return 0;
  const due = await tx.cheque.findMany({
    where: bankTodayWhere(now, { heldOnly: true }),
    orderBy: { chequeDate: "asc" },
    select: { number: true, payment: { select: { amount: true, retailer: { select: { outletName: true } } } } },
  });
  if (!due.length) return 0;
  const staff = await tx.user.findMany({ where: { active: true, isSupport: false, role: { not: "RETAILER" } }, select: { id: true, role: true } });
  const to = staff.filter((u) => can(u.role, "cheques.manage")).map((u) => u.id);
  if (!to.length) return 0;
  const shops = due.slice(0, 5).map((c) => `${c.payment.retailer.outletName} #${c.number}`);
  const day = istDay(now);
  await notify(tx, tenantId, {
    event: "staff.cheques_due",
    to,
    vars: {
      count: due.length,
      amount: formatINR(due.reduce((s, c) => s + c.payment.amount, 0), { whole: true }),
      shops: shops.join(", ") + (due.length > shops.length ? ` and ${due.length - shops.length} more` : ""),
    },
    link: "/admin/payments?tab=cheques&cheques=due",
    key: `cheques_due:${day}`,
  });
  return due.length;
}
