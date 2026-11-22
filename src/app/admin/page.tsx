import Link from "next/link";
import { redirect } from "next/navigation";
import { formatINR } from "@/lib/money";
import { pageSession } from "@/lib/guard";
import { getTenant } from "@/lib/tenant";
import { withTenantTx } from "@/lib/db";
import { STATUS_COLOR } from "@/lib/orders";
import { getServerLang, tr } from "@/lib/i18n/server";
import { addDay, istDay, istDayRange } from "@/lib/field-math";
import { collections, outstanding } from "@/lib/analytics";
import type { OrderStatus } from "@/generated/prisma/client";
import Icon, { type IconName } from "@/components/Icon";
import StockAlertStrip from "@/components/stock/overview/StockAlertStrip";

const OPEN: OrderStatus[] = ["PLACED", "CONFIRMED", "PACKED", "OUT_FOR_DELIVERY"];

/** Bar colour per stage — the same family as the status chips. */
const STAGE_BAR: Record<OrderStatus, string> = {
  PLACED: "#e0a21e",
  CONFIRMED: "#2f7f78",
  PACKED: "#0f2a2a",
  OUT_FOR_DELIVERY: "#db5c17",
  DELIVERED: "#2ba884",
  CANCELLED: "#a8281e",
};

const STALE_HOURS = 2;

function pct(now: number, before: number) {
  if (!before) return null;
  return Math.round(((now - before) / before) * 100);
}

export default async function AdminDashboard() {
  // Check here, not only in the layout: a client navigation can render this page without its layout.
  const session = await pageSession();
  if (!session || session.role !== "ADMIN") redirect("/login");
  const tenant = await getTenant();
  if (!tenant) redirect("/login");
  const lang = await getServerLang();

  const now = new Date();
  const today = istDay(now);
  const lastWeek = addDay(today, -7);
  const todayR = istDayRange(today);
  const lastWeekR = istDayRange(lastWeek);
  const weekStart = istDayRange(addDay(today, -6)).from;

  const d = await withTenantTx(tenant.id, async (tx) => {
    const [
      todayOrders,
      lastWeekOrders,
      openByStatus,
      doneToday,
      money,
      owed,
      stale,
      held,
      openTickets,
      recent,
      byDay,
      onDuty,
      onDutyNow,
      salesAgents,
      deliveryAgents,
    ] = await Promise.all([
      tx.order.aggregate({ where: { createdAt: { gte: todayR.from, lt: todayR.to }, status: { not: "CANCELLED" } }, _count: true, _sum: { totalAmount: true } }),
      tx.order.aggregate({ where: { createdAt: { gte: lastWeekR.from, lt: lastWeekR.to }, status: { not: "CANCELLED" } }, _count: true, _sum: { totalAmount: true } }),
      tx.order.groupBy({ by: ["status"], where: { status: { in: OPEN } }, _count: true, _sum: { totalAmount: true } }),
      Promise.all([
        tx.order.aggregate({ where: { status: "DELIVERED", delivery: { deliveredAt: { gte: todayR.from, lt: todayR.to } } }, _count: true, _sum: { totalAmount: true } }),
        tx.order.count({ where: { status: "CANCELLED", updatedAt: { gte: todayR.from, lt: todayR.to } } }),
      ]),
      collections(tx, { from: today, to: today, start: todayR.from, end: todayR.to, days: 1 }),
      outstanding(tx, now, { top: 0 }),
      tx.order.count({ where: { status: "PLACED", createdAt: { lt: new Date(now.getTime() - STALE_HOURS * 3_600_000) } } }),
      tx.order.count({ where: { creditHold: true, creditApprovedAt: null, status: { in: OPEN } } }),
      tx.ticket.count({ where: { status: { in: ["OPEN", "IN_PROGRESS", "WAITING"] } } }),
      tx.order.findMany({
        take: 8,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          orderNumber: true,
          status: true,
          totalAmount: true,
          createdAt: true,
          retailer: { select: { outletName: true, area: { select: { name: true } } } },
          delivery: { select: { deliveryAgent: { select: { user: { select: { name: true } } } } } },
        },
      }),
      tx.$queryRaw<{ day: string; total: bigint }[]>`
        SELECT to_char("createdAt" + interval '330 minutes', 'YYYY-MM-DD') AS day, COALESCE(SUM("totalAmount"), 0)::bigint AS total
        FROM "Order" WHERE "createdAt" >= ${weekStart} AND "createdAt" < ${todayR.to} AND status::text <> 'CANCELLED'
        GROUP BY 1`,
      tx.attendance.findMany({
        where: { date: today, checkInAt: { not: null } },
        orderBy: { checkInAt: "asc" },
        take: 6,
        select: { checkInAt: true, checkOutAt: true, user: { select: { name: true, role: true } } },
      }),
      tx.attendance.count({ where: { date: today, checkInAt: { not: null }, checkOutAt: null } }),
      tx.salesAgentProfile.count(),
      tx.deliveryAgentProfile.count(),
    ]);
    return { todayOrders, lastWeekOrders, openByStatus, doneToday, money, owed, stale, held, openTickets, recent, byDay, onDuty, onDutyNow, salesAgents, deliveryAgents };
    // Read-only; a dozen small queries on one connection can pass the 5 s default on a busy day.
  }, { timeout: 20_000 });

  const ordersToday = d.todayOrders._count;
  const valueToday = d.todayOrders._sum.totalAmount ?? 0;
  const ordersChange = pct(ordersToday, d.lastWeekOrders._count);
  const valueChange = pct(valueToday, d.lastWeekOrders._sum.totalAmount ?? 0);
  const weekday = new Date(lastWeekR.from.getTime() + 6 * 3_600_000).toLocaleDateString("en-IN", { weekday: "long", timeZone: "Asia/Kolkata" });

  const [deliveredToday, cancelledToday] = d.doneToday;
  const stage = (s: OrderStatus) => {
    if (s === "DELIVERED") return { count: deliveredToday._count, value: deliveredToday._sum.totalAmount ?? 0 };
    const g = d.openByStatus.find((x) => x.status === s);
    return { count: g?._count ?? 0, value: g?._sum.totalAmount ?? 0 };
  };
  const stages = ([...OPEN, "DELIVERED"] as OrderStatus[]).map((s) => ({ status: s, ...stage(s) }));
  const stageTotal = stages.reduce((a, s) => a + s.count, 0);
  const openCount = OPEN.reduce((a, s) => a + stage(s).count, 0);

  const days = Array.from({ length: 7 }, (_, i) => addDay(today, i - 6)).map((day) => ({
    day,
    total: Number(d.byDay.find((r) => r.day === day)?.total ?? 0),
  }));
  const weekTotal = days.reduce((a, x) => a + x.total, 0);
  const peak = Math.max(1, ...days.map((x) => x.total));

  const onDutyNow = d.onDutyNow;
  const fieldStaff = d.salesAgents + d.deliveryAgents;

  const attention = [
    d.stale > 0 && {
      icon: "clock" as IconName,
      tone: "kesar",
      title: `${d.stale} ${d.stale === 1 ? "order" : "orders"} waiting ${STALE_HOURS}+ hours`,
      sub: "Placed, not yet confirmed",
      href: "/admin/orders?status=PLACED",
      cta: "Review",
    },
    d.held > 0 && {
      icon: "lock" as IconName,
      tone: "red",
      title: `${d.held} ${d.held === 1 ? "order" : "orders"} on credit hold`,
      sub: "Over the credit limit or with overdue bills",
      href: "/admin/orders?status=PLACED",
      cta: "Decide",
    },
    d.money.pending.count > 0 && {
      icon: "card" as IconName,
      tone: "mor",
      title: `${d.money.pending.count} ${d.money.pending.count === 1 ? "payment" : "payments"} to verify`,
      sub: `${formatINR(d.money.pending.amount, { whole: true })} reported by shops`,
      href: "/admin/payments",
      cta: "Verify",
    },
    d.openTickets > 0 && {
      icon: "chat" as IconName,
      tone: "blue",
      title: `${d.openTickets} open ${d.openTickets === 1 ? "complaint" : "complaints"}`,
      sub: "Waiting for an answer or a fix",
      href: "/admin/complaints",
      cta: "View",
    },
    d.owed.overdue > 0 && {
      icon: "book" as IconName,
      tone: "genda",
      title: `${formatINR(d.owed.overdue, { whole: true })} overdue`,
      sub: "Bills past their due date",
      href: "/admin/khata",
      cta: "Khata",
    },
  ].filter(Boolean) as { icon: IconName; tone: keyof typeof TONES; title: string; sub: string; href: string; cta: string }[];

  const hour = Number(new Date(now.getTime() + 330 * 60_000).toISOString().slice(11, 13));
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = session.name.split(/\s+/)[0] ?? "";
  const dateLine = now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" });

  return (
    <div className="space-y-5">
      <div className="page-head">
        <div>
          <p className="text-sm text-[var(--muted)]">{dateLine}</p>
          <h1 className="page-title">
            {greet}
            {firstName ? `, ${firstName}` : ""}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/reports" className="btn btn-outline btn-sm">
            <Icon name="chart" className="h-4 w-4" /> Reports
          </Link>
          <Link href="/admin/orders" className="btn btn-kesar btn-sm">
            Manage orders <Icon name="arrow" className="h-4 w-4" />
          </Link>
        </div>
      </div>

      <section aria-label="Today at a glance" className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        <Kpi
          icon="box"
          tone="kesar"
          label="Orders today"
          value={String(ordersToday)}
          delta={ordersChange}
          note={`vs last ${weekday}`}
          href="/admin/orders"
        />
        <Kpi
          icon="rupee"
          tone="mor"
          label="Order value today"
          value={formatINR(valueToday, { whole: true })}
          delta={valueChange}
          note={`vs last ${weekday}`}
          href="/admin/orders"
        />
        <Kpi
          icon="card"
          tone="mint"
          label="Collected today"
          value={formatINR(d.money.received, { whole: true })}
          note={d.money.pending.count ? `${d.money.pending.count} to verify` : "All verified"}
          href="/admin/payments"
        />
        <Kpi
          icon="book"
          tone="genda"
          label="Dues outstanding"
          value={formatINR(d.owed.total, { whole: true })}
          note={d.owed.shops ? `${d.owed.shops} ${d.owed.shops === 1 ? "shop" : "shops"} · ${formatINR(d.owed.overdue, { whole: true })} overdue` : "Nothing owed"}
          noteTone={d.owed.overdue ? "red" : undefined}
          href="/admin/khata"
        />
      </section>

      <section aria-labelledby="pipe" className="card p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id="pipe" className="font-bold text-base flex-1">Order pipeline</h2>
          <span className="text-sm text-[var(--muted)]">
            {openCount} open{cancelledToday ? ` · ${cancelledToday} cancelled today` : ""}
          </span>
          <Link href="/admin/dispatch" className="text-sm font-semibold text-[var(--kesar-text)]">
            Dispatch board →
          </Link>
        </div>
        {stageTotal > 0 && (
          <div className="flex h-2.5 rounded-full overflow-hidden gap-0.5" aria-hidden="true">
            {stages
              .filter((s) => s.count)
              .map((s) => (
                <div key={s.status} style={{ flex: s.count, background: STAGE_BAR[s.status] }} />
              ))}
          </div>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
          {stages.map((s) => (
            <Link
              key={s.status}
              href={`/admin/orders?status=${s.status}`}
              className="rounded-xl border border-[var(--app-line)] px-3.5 py-3 hover:border-[#c9d3d0] hover:bg-[#f8faf9] transition"
            >
              <span className="flex items-center gap-2 text-[13px] font-semibold text-[var(--ink-2)]">
                <span className="h-2 w-2 rounded-full shrink-0" style={{ background: STAGE_BAR[s.status] }} />
                {tr(`status.${s.status}`, lang)}
                {s.status === "DELIVERED" && <span className="font-normal text-[var(--muted)]">· today</span>}
              </span>
              <span className="block mt-1 text-[22px] font-bold num leading-tight">{s.count}</span>
              <span className="block text-xs text-[var(--muted)] num">{formatINR(s.value, { whole: true })}</span>
            </Link>
          ))}
        </div>
      </section>

      <StockAlertStrip />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px] items-start">
        <div className="space-y-5 min-w-0">
          <section aria-labelledby="recent" className="card overflow-hidden">
            <div className="flex items-center gap-3 px-4 sm:px-5 py-3.5 border-b border-[var(--app-line)]">
              <h2 id="recent" className="font-bold text-base flex-1">Recent orders</h2>
              <Link href="/admin/orders" className="text-sm font-semibold text-[var(--kesar-text)]">
                View all →
              </Link>
            </div>
            {/* Table from tablet up; a list on phones. */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="dt min-w-[640px]">
                <thead>
                  <tr>
                    <th scope="col">Order</th>
                    <th scope="col">Shop</th>
                    <th scope="col">Delivery</th>
                    <th scope="col" className="!text-right">Amount</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="!text-right">Placed</th>
                  </tr>
                </thead>
                <tbody>
                  {d.recent.map((o) => (
                    <tr key={o.id}>
                      <td className="font-semibold num whitespace-nowrap">
                        <Link href={`/admin/orders?q=${encodeURIComponent(o.orderNumber)}`} className="hover:underline">
                          {o.orderNumber}
                        </Link>
                      </td>
                      <td>
                        <span className="block font-semibold">{o.retailer.outletName}</span>
                        <span className="block text-xs text-[var(--muted)]">{o.retailer.area.name}</span>
                      </td>
                      <td className="text-[var(--ink-2)]">{o.delivery?.deliveryAgent.user.name ?? "—"}</td>
                      <td className="text-right font-semibold num whitespace-nowrap">{formatINR(o.totalAmount, { whole: true })}</td>
                      <td>
                        <span className={`text-xs px-2.5 py-1 rounded-full ${STATUS_COLOR[o.status]}`}>{tr(`status.${o.status}`, lang)}</span>
                      </td>
                      <td className="text-right text-[var(--muted)] num whitespace-nowrap">{placedAt(o.createdAt, today)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="sm:hidden divide-y divide-[#eef2f1]">
              {d.recent.map((o) => (
                <li key={o.id}>
                  <Link href={`/admin/orders?q=${encodeURIComponent(o.orderNumber)}`} className="flex items-center gap-3 px-4 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold truncate">{o.retailer.outletName}</span>
                      <span className="block text-xs text-[var(--muted)] truncate num">
                        {o.orderNumber} · {formatINR(o.totalAmount, { whole: true })} · {placedAt(o.createdAt, today)}
                      </span>
                    </span>
                    <span className={`shrink-0 text-[11px] px-2 py-0.5 rounded-full ${STATUS_COLOR[o.status]}`}>{tr(`status.${o.status}`, lang)}</span>
                  </Link>
                </li>
              ))}
            </ul>
            {d.recent.length === 0 && <p className="px-5 py-6 text-sm text-[var(--muted)]">No orders yet.</p>}
          </section>

          <section aria-labelledby="week" className="card p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 id="week" className="font-bold text-base flex-1">Order value, last 7 days</h2>
              <span className="text-xl font-bold num">{formatINR(weekTotal, { whole: true })}</span>
            </div>
            <div className="flex items-end gap-2 sm:gap-3.5 h-40 border-b border-[var(--app-line)]" role="img" aria-label={`Order value per day for the last 7 days, ${formatINR(weekTotal, { whole: true })} in all`}>
              {days.map((x, i) => (
                <div key={x.day} className="flex-1 h-full flex flex-col items-center justify-end gap-1.5 min-w-0">
                  <span className="text-[10.5px] sm:text-[11px] text-[var(--muted)] num truncate max-w-full">{short(x.total)}</span>
                  <div
                    className="w-full max-w-11 rounded-t-md"
                    style={{ height: `${Math.max(2, Math.round((x.total / peak) * 100))}%`, maxHeight: "calc(100% - 20px)", background: i === 6 ? "var(--kesar)" : "#b9d3ce" }}
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-2 sm:gap-3.5 -mt-2">
              {days.map((x, i) => (
                <span key={x.day} className={`flex-1 text-center text-xs ${i === 6 ? "font-bold text-ink" : "text-[var(--muted)]"}`}>
                  {i === 6 ? "Today" : new Date(istDayRange(x.day).from.getTime() + 6 * 3_600_000).toLocaleDateString("en-IN", { weekday: "short", timeZone: "Asia/Kolkata" })}
                </span>
              ))}
            </div>
          </section>
        </div>

        <div className="space-y-5 min-w-0">
          <section aria-labelledby="attn" className="card overflow-hidden">
            <div className="flex items-center gap-2 px-4 sm:px-5 py-3.5 border-b border-[var(--app-line)]">
              <h2 id="attn" className="font-bold text-base flex-1">Needs your attention</h2>
              {attention.length > 0 && <span className="chip chip-kesar !py-0.5">{attention.length}</span>}
            </div>
            {attention.length === 0 ? (
              <p className="flex items-center gap-2 px-5 py-5 text-sm text-[var(--mint-text)] font-semibold">
                <Icon name="check" className="h-5 w-5" /> All clear for now.
              </p>
            ) : (
              <ul className="divide-y divide-[#eef2f1]">
                {attention.map((a) => (
                  <li key={a.title}>
                    <Link href={a.href} className="flex items-center gap-3 px-4 sm:px-5 py-3 hover:bg-[#f8faf9] min-h-[60px]">
                      <span className={`icon-tile !h-9 !w-9 !rounded-[10px] ${TONES[a.tone]}`}>
                        <Icon name={a.icon} className="!h-[18px] !w-[18px]" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold">{a.title}</span>
                        <span className="block text-xs text-[var(--muted)]">{a.sub}</span>
                      </span>
                      <span className="text-sm font-semibold text-[var(--kesar-text)] whitespace-nowrap">{a.cta}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="field" className="card overflow-hidden">
            <div className="flex items-center gap-2 px-4 sm:px-5 py-3.5 border-b border-[var(--app-line)]">
              <h2 id="field" className="font-bold text-base flex-1">Field team today</h2>
              <span className="text-sm text-[var(--muted)]">
                {onDutyNow} of {fieldStaff} on duty
              </span>
            </div>
            {d.onDuty.length === 0 ? (
              <p className="px-5 py-5 text-sm text-[var(--muted)]">Nobody has checked in yet today.</p>
            ) : (
              <ul className="divide-y divide-[#eef2f1]">
                {d.onDuty.map((a, i) => (
                  <li key={i} className="flex items-center gap-3 px-4 sm:px-5 py-3">
                    <span className="grid place-items-center h-9 w-9 shrink-0 rounded-full bg-[#e1eeec] text-[var(--mor)] text-xs font-bold" aria-hidden="true">
                      {a.user.name
                        .split(/\s+/)
                        .slice(0, 2)
                        .map((w) => w[0])
                        .join("")
                        .toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold truncate">{a.user.name}</span>
                      <span className="block text-xs text-[var(--muted)]">
                        {ROLE_LABEL[a.user.role] ?? "Staff"} · in at {clock(a.checkInAt!)}
                      </span>
                    </span>
                    {a.checkOutAt ? (
                      <span className="flex items-center gap-1.5 text-xs font-bold text-[var(--ink-2)]">
                        <span className="h-2 w-2 rounded-full bg-[#9aaeaa]" /> Off duty
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 text-xs font-bold text-[var(--mint-text)]">
                        <span className="h-2 w-2 rounded-full bg-[#2ba884]" /> On duty
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="px-4 sm:px-5 py-3 border-t border-[#eef2f1]">
              <Link href="/team" className="text-sm font-semibold text-[var(--kesar-text)]">
                See the team on the map →
              </Link>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

const ROLE_LABEL: Partial<Record<string, string>> = {
  SALES_AGENT: "Sales",
  DELIVERY_AGENT: "Delivery",
  SUPERVISOR: "Supervisor",
  ADMIN: "Office",
};

const TONES = {
  kesar: "bg-[var(--kesar-tint)] text-[var(--kesar-text)]",
  mor: "bg-[#e1eeec] text-[var(--mor)]",
  genda: "bg-[var(--genda-tint)] text-[var(--genda-text)]",
  mint: "bg-[var(--mint-tint)] text-[var(--mint-text)]",
  red: "bg-[#fde4e1] text-[#a8281e]",
  blue: "bg-[#e3eef8] text-[#1f4e79]",
};

const clock = (d: Date) => d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

/** Time for today's orders, day and month for older ones. */
function placedAt(d: Date, today: string) {
  return istDay(d) === today ? clock(d) : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
}

/** ₹3.4L / ₹42K / ₹950 — short labels over the bars. */
function short(paise: number) {
  const r = paise / 100;
  if (r >= 1_00_00_000) return `₹${(r / 1_00_00_000).toFixed(1)}Cr`;
  if (r >= 1_00_000) return `₹${(r / 1_00_000).toFixed(1)}L`;
  if (r >= 1_000) return `₹${Math.round(r / 1_000)}K`;
  return `₹${Math.round(r)}`;
}

function Kpi({
  icon,
  tone,
  label,
  value,
  delta,
  note,
  noteTone,
  href,
}: {
  icon: IconName;
  tone: keyof typeof TONES;
  label: string;
  value: string;
  delta?: number | null;
  note: string;
  noteTone?: "red";
  href: string;
}) {
  return (
    <Link href={href} className="card p-4 sm:p-[18px] flex flex-col gap-1.5 hover:border-[#c9d3d0] transition min-w-0">
      <span className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-[var(--muted)]">{label}</span>
        <span className={`hidden sm:grid place-items-center h-8 w-8 rounded-lg ${TONES[tone]}`}>
          <Icon name={icon} className="h-[17px] w-[17px]" />
        </span>
      </span>
      <span className="text-[22px] sm:text-[28px] font-bold leading-tight num tracking-[-0.02em] truncate">{value}</span>
      <span className={`text-xs sm:text-[13px] ${noteTone === "red" ? "text-[#a8281e]" : "text-[var(--muted)]"}`}>
        {delta != null && (
          <span className={`font-bold ${delta >= 0 ? "text-[var(--mint-text)]" : "text-[#a8281e]"}`}>
            {delta >= 0 ? "+" : ""}
            {delta}%{" "}
          </span>
        )}
        {note}
      </span>
    </Link>
  );
}
