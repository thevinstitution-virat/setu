/**
 * Phase 10 analytics: read-only figures over an IST period, compared with the
 * period just before it. Everything runs inside one tenant transaction
 * (withTenantTx), so row-level security keeps it to the one business.
 *
 * Where the numbers come from:
 * - Sales are documents, not orders: tax invoices and bills of supply, minus
 *   credit notes, plus debit notes (an order counts once it is delivered and
 *   invoiced). "Net" is with GST; "taxable" is without, used for margins.
 * - Orders are what was booked (placed in the period, not cancelled).
 * - Collections are confirmed payments against dues (not wallet top-ups).
 * - Outstanding and ageing are today's open bills (not the period).
 * - Stock value is lots on hand × their cost (or the product's last cost).
 * - Cost of goods for margins: the cost of the stock that went out on each
 *   invoice line (SALE moves), else the product's last cost; returns put it back.
 *
 * Plain maths only (no AI): churn risk is "days since the last order" against
 * the shop's own usual gap between orders.
 */
import type { InvoiceType, PayMethod, Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db";
import { AGE_BUCKETS, ageBills, type Ageing } from "@/lib/ledger";
import { addDay, istDay, istDayRange, istMonth, pctOf } from "@/lib/field-math";
import { MoneyError } from "@/lib/money-error";
import { FAIL_REASONS, SHORT_REASONS } from "@/lib/delivery-settings";
import type { ReportSettings } from "@/lib/report-settings";

const DAY = 86_400_000;
const SALE_TYPES: InvoiceType[] = ["TAX_INVOICE", "BILL_OF_SUPPLY"];

export { MAX_DAYS, PRESETS, change, isPreset, makePeriod, parsePeriod, presetPeriod, previousPeriod, type Period, type Preset } from "@/lib/report-periods";
import { change, makePeriod, previousPeriod, type Period } from "@/lib/report-periods";

const share = (part: number, whole: number) => (whole ? Math.round((part * 1000) / whole) / 10 : 0);
/** Like share, but null when there is nothing to measure (shown as "–", not 0%). */
const rate = (part: number, whole: number): number | null => (whole ? share(part, whole) : null);
const range = (p: Period) => ({ gte: p.start, lt: p.end });

// ───────────────────────────── sales ─────────────────────────────

export type SalesTotals = { net: number; netTaxable: number; gross: number; credits: number; debits: number; invoices: number };

export async function salesTotals(tx: Tx, p: Period): Promise<SalesTotals> {
  const g = await tx.invoice.groupBy({ by: ["type"], where: { date: range(p) }, _sum: { total: true, taxable: true }, _count: true });
  const of = (t: InvoiceType) => g.find((x) => x.type === t);
  const sum = (types: InvoiceType[], k: "total" | "taxable") => types.reduce((a, t) => a + (of(t)?._sum[k] ?? 0), 0);
  const gross = sum(SALE_TYPES, "total");
  const credits = sum(["CREDIT_NOTE"], "total");
  const debits = sum(["DEBIT_NOTE"], "total");
  return {
    gross,
    credits,
    debits,
    net: gross - credits + debits,
    netTaxable: sum(SALE_TYPES, "taxable") - sum(["CREDIT_NOTE"], "taxable") + sum(["DEBIT_NOTE"], "taxable"),
    invoices: SALE_TYPES.reduce((a, t) => a + (of(t)?._count ?? 0), 0),
  };
}

export type OrderTotals = { count: number; value: number; avg: number; cancelled: number };

export async function orderTotals(tx: Tx, p: Period, where: Prisma.OrderWhereInput = {}): Promise<OrderTotals> {
  const g = await tx.order.groupBy({ by: ["status"], where: { ...where, createdAt: range(p) }, _sum: { totalAmount: true }, _count: true });
  const live = g.filter((x) => x.status !== "CANCELLED");
  const count = live.reduce((a, x) => a + x._count, 0);
  const value = live.reduce((a, x) => a + (x._sum.totalAmount ?? 0), 0);
  return { count, value, avg: count ? Math.round(value / count) : 0, cancelled: g.find((x) => x.status === "CANCELLED")?._count ?? 0 };
}

/** Net sales per IST day (every day of the period, 0 when nothing). */
export async function salesByDay(tx: Tx, p: Period): Promise<{ day: string; net: number }[]> {
  const rows = await tx.$queryRaw<{ day: string; type: string; total: bigint }[]>`
    SELECT to_char("date" + interval '330 minutes', 'YYYY-MM-DD') AS day, type::text AS type, COALESCE(SUM(total), 0)::bigint AS total
    FROM "Invoice" WHERE "date" >= ${p.start} AND "date" < ${p.end}
    GROUP BY 1, 2`;
  const by = new Map<string, number>();
  for (const r of rows) {
    const sign = r.type === "CREDIT_NOTE" ? -1 : 1;
    by.set(r.day, (by.get(r.day) ?? 0) + sign * Number(r.total));
  }
  const out: { day: string; net: number }[] = [];
  for (let d = p.from; d <= p.to; d = addDay(d, 1)) out.push({ day: d, net: by.get(d) ?? 0 });
  return out;
}

/** Net taxable sales and quantity per product (sales minus credit notes), with category and brand. */
export async function productMix(tx: Tx, p: Period, where: Prisma.InvoiceWhereInput = {}) {
  const lines = await tx.invoiceLine.groupBy({
    by: ["productId"],
    where: { productId: { not: null }, invoice: { ...where, date: range(p), type: { in: SALE_TYPES } } },
    _sum: { taxable: true, quantity: true },
  });
  const credit = await tx.invoiceLine.groupBy({
    by: ["productId"],
    where: { productId: { not: null }, invoice: { ...where, date: range(p), type: "CREDIT_NOTE" } },
    _sum: { taxable: true, quantity: true },
  });
  const cr = new Map(credit.map((c) => [c.productId!, c._sum]));
  const ids = lines.map((l) => l.productId!);
  const products = ids.length
    ? await tx.product.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, sku: true, category: { select: { id: true, name: true } }, brand: { select: { id: true, name: true } } } })
    : [];
  const info = new Map(products.map((x) => [x.id, x]));
  const rows = lines
    .map((l) => {
      const c = cr.get(l.productId!);
      const taxable = (l._sum.taxable ?? 0) - (c?.taxable ?? 0);
      const qty = (l._sum.quantity ?? 0) - (c?.quantity ?? 0);
      const x = info.get(l.productId!);
      return { productId: l.productId!, name: x?.name ?? "Removed product", sku: x?.sku ?? "", category: x?.category.name ?? "Other", brand: x?.brand?.name ?? null, taxable, qty };
    })
    .filter((r) => r.taxable !== 0 || r.qty !== 0)
    .sort((a, b) => b.taxable - a.taxable);
  const total = rows.reduce((a, r) => a + r.taxable, 0);
  const cats = new Map<string, number>();
  for (const r of rows) cats.set(r.category, (cats.get(r.category) ?? 0) + r.taxable);
  return {
    total,
    products: rows.map((r) => ({ ...r, share: share(r.taxable, total) })),
    categories: [...cats.entries()].map(([name, taxable]) => ({ name, taxable, share: share(taxable, total) })).sort((a, b) => b.taxable - a.taxable),
  };
}

// ───────────────────────────── money ─────────────────────────────

const METHODS: PayMethod[] = ["CASH", "UPI", "CHEQUE", "BANK", "ONLINE", "WALLET", "CREDIT_NOTE"];

export async function collections(tx: Tx, p: Period) {
  const [g, pending, wallet] = await Promise.all([
    tx.payment.groupBy({ by: ["method"], where: { purpose: "DUES", state: "CONFIRMED", collectedAt: range(p) }, _sum: { amount: true }, _count: true }),
    tx.payment.aggregate({ where: { state: "PENDING_VERIFICATION" }, _sum: { amount: true }, _count: true }),
    tx.payment.aggregate({ where: { purpose: "WALLET", state: "CONFIRMED", collectedAt: range(p) }, _sum: { amount: true } }),
  ]);
  const byMethod = METHODS.map((m) => ({ method: m, amount: g.find((x) => x.method === m)?._sum.amount ?? 0, count: g.find((x) => x.method === m)?._count ?? 0 })).filter((x) => x.amount || x.count);
  // Credit notes and wallet use settle bills but bring in no money.
  const received = byMethod.filter((x) => x.method !== "CREDIT_NOTE" && x.method !== "WALLET").reduce((a, x) => a + x.amount, 0);
  return {
    received,
    total: byMethod.reduce((a, x) => a + x.amount, 0),
    byMethod,
    walletTopUps: wallet._sum.amount ?? 0,
    pending: { count: pending._count, amount: pending._sum.amount ?? 0 },
  };
}

export type Debtor = { retailerId: string; outletName: string; area: string; outstanding: number; overdue: number; oldestDays: number };

/** Open bills today: total, overdue, ageing and the shops owing most. */
export async function outstanding(tx: Tx, now = new Date(), opts: { top?: number; where?: Prisma.BillWhereInput } = {}) {
  const bills = await tx.bill.findMany({ where: { ...opts.where, settled: false }, select: { retailerId: true, date: true, dueDate: true, amount: true, paid: true } });
  const ageing: Ageing = ageBills(bills, now);
  const today = istDay(now);
  let total = 0;
  let overdue = 0;
  const by = new Map<string, { outstanding: number; overdue: number; oldest: Date }>();
  for (const b of bills) {
    const left = b.amount - b.paid;
    if (left <= 0) continue;
    const late = istDay(b.dueDate) < today;
    total += left;
    if (late) overdue += left;
    const r = by.get(b.retailerId) ?? { outstanding: 0, overdue: 0, oldest: b.date };
    r.outstanding += left;
    if (late) r.overdue += left;
    if (b.date < r.oldest) r.oldest = b.date;
    by.set(b.retailerId, r);
  }
  const topIds = [...by.entries()].sort((a, b) => b[1].outstanding - a[1].outstanding).slice(0, opts.top ?? 10);
  const shops = topIds.length
    ? await tx.retailerProfile.findMany({ where: { id: { in: topIds.map(([id]) => id) } }, select: { id: true, outletName: true, area: { select: { name: true } } } })
    : [];
  const shop = new Map(shops.map((s) => [s.id, s]));
  const todayMs = istDayRange(today).from.getTime();
  const debtors: Debtor[] = topIds.map(([id, r]) => ({
    retailerId: id,
    outletName: shop.get(id)?.outletName ?? "",
    area: shop.get(id)?.area.name ?? "",
    outstanding: r.outstanding,
    overdue: r.overdue,
    oldestDays: Math.max(0, Math.floor((todayMs - istDayRange(istDay(r.oldest)).from.getTime()) / DAY)),
  }));
  return {
    total,
    overdue,
    shops: by.size,
    ageing: AGE_BUCKETS.map((b) => ({ key: b.key, label: b.label, amount: ageing[b.key], share: share(ageing[b.key], total) })),
    debtors,
  };
}

// ───────────────────────────── stock ─────────────────────────────

export async function stockValue(tx: Tx, now = new Date()) {
  const lots = await tx.stockLot.findMany({
    where: { qty: { gt: 0 } },
    select: { qty: true, unitCost: true, expiry: true, productId: true, location: { select: { kind: true } }, product: { select: { name: true, lastCost: true } } },
  });
  const today = istDayRange(istDay(now)).from;
  const soon = new Date(today.getTime() + 30 * DAY);
  const out = { total: 0, warehouse: 0, van: 0, damaged: 0, nearExpiry: 0, expired: 0, uncostedLots: 0, units: 0 };
  const byProduct = new Map<string, { name: string; value: number; qty: number }>();
  for (const l of lots) {
    const cost = l.unitCost ?? l.product.lastCost;
    if (cost == null) out.uncostedLots++;
    const v = l.qty * (cost ?? 0);
    out.units += l.qty;
    if (l.location.kind === "DAMAGED") {
      out.damaged += v;
      continue;
    }
    out.total += v;
    if (l.location.kind === "VAN") out.van += v;
    else out.warehouse += v;
    if (l.expiry && l.expiry < today) out.expired += v;
    else if (l.expiry && l.expiry < soon) out.nearExpiry += v;
    const p = byProduct.get(l.productId) ?? { name: l.product.name, value: 0, qty: 0 };
    p.value += v;
    p.qty += l.qty;
    byProduct.set(l.productId, p);
  }
  return {
    ...out,
    top: [...byProduct.entries()].map(([productId, p]) => ({ productId, ...p, share: share(p.value, out.total) })).sort((a, b) => b.value - a.value).slice(0, 8),
  };
}

// ───────────────────────────── delivery ─────────────────────────────

export async function deliveryPerformance(tx: Tx, p: Period) {
  const rows = await tx.delivery.findMany({
    where: { OR: [{ deliveredAt: range(p) }, { state: "FAILED", failedAt: range(p) }] },
    select: { state: true, deliveredAt: true, attempts: true, failReason: true, tripId: true, deliveryAgentId: true, order: { select: { deliveryDate: true } } },
  });
  const delivered = rows.filter((r) => r.state === "DELIVERED");
  const failed = rows.filter((r) => r.state === "FAILED");
  const promised = delivered.filter((r) => r.order.deliveryDate);
  // deliveryDate is a calendar date (UTC midnight); compare IST days.
  const onTime = promised.filter((r) => istDay(r.deliveredAt!) <= r.order.deliveryDate!.toISOString().slice(0, 10)).length;
  const firstAttempt = delivered.filter((r) => r.attempts <= 1).length;
  const reasons = new Map<string, number>();
  for (const f of failed) reasons.set(f.failReason ?? "other", (reasons.get(f.failReason ?? "other") ?? 0) + 1);

  const shortLines = await tx.orderItem.findMany({
    where: { order: { delivery: { deliveredAt: range(p) } }, orderedQty: { not: null }, deliveredQty: { not: null } },
    select: { orderedQty: true, deliveredQty: true, price: true, shortReason: true },
  });
  const short = shortLines.filter((l) => (l.deliveredQty ?? 0) < (l.orderedQty ?? 0));
  const trips = new Set(delivered.map((d) => d.tripId).filter(Boolean)).size;
  return {
    delivered: delivered.length,
    failed: failed.length,
    successRate: rate(delivered.length, delivered.length + failed.length),
    onTime,
    onTimeRate: rate(onTime, promised.length),
    firstAttemptRate: rate(firstAttempt, delivered.length),
    trips,
    dropsPerTrip: trips ? Math.round((delivered.filter((d) => d.tripId).length * 10) / trips) / 10 : 0,
    failReasons: [...reasons.entries()].map(([key, count]) => ({ key, label: FAIL_REASONS[key as keyof typeof FAIL_REASONS] ?? key, count })).sort((a, b) => b.count - a.count),
    shortLines: short.length,
    shortValue: short.reduce((a, l) => a + ((l.orderedQty ?? 0) - (l.deliveredQty ?? 0)) * l.price, 0),
  };
}

// ───────────────────────────── team ─────────────────────────────

/** Sales agents (orders, visits, strike rate, collections, value target) and drivers (drops, on time, cash). */
export async function agentPerformance(tx: Tx, p: Period) {
  const month = istMonth(new Date(p.end.getTime() - 1));
  const staff = await tx.user.findMany({
    where: { role: { in: ["SALES_AGENT", "SUPERVISOR", "DELIVERY_AGENT"] }, active: true },
    select: { id: true, name: true, role: true, salesAgentProfile: { select: { id: true } }, deliveryAgentProfile: { select: { id: true } } },
    orderBy: { name: "asc" },
  });
  const ids = staff.map((s) => s.id);
  const [orders, visits, pays, cash, drops, targets] = await Promise.all([
    tx.order.groupBy({ by: ["placedById"], where: { placedById: { in: ids }, createdAt: range(p), status: { not: "CANCELLED" } }, _sum: { totalAmount: true }, _count: true }),
    tx.visit.findMany({ where: { checkInAt: range(p), salesAgent: { userId: { in: ids } } }, select: { outcome: true, retailerId: true, salesAgent: { select: { userId: true } } } }),
    tx.payment.groupBy({ by: ["collectedById"], where: { collectedById: { in: ids }, collectedAt: range(p), state: "CONFIRMED", purpose: "DUES" }, _sum: { amount: true } }),
    tx.payment.groupBy({ by: ["collectedById"], where: { collectedById: { in: ids }, collectedAt: range(p), state: { in: ["CONFIRMED", "PENDING_VERIFICATION"] }, method: "CASH" }, _sum: { amount: true } }),
    tx.delivery.findMany({ where: { OR: [{ deliveredAt: range(p) }, { state: "FAILED", failedAt: range(p) }] }, select: { state: true, deliveredAt: true, deliveryAgentId: true, tripId: true, order: { select: { deliveryDate: true } } } }),
    tx.target.findMany({ where: { period: month, metric: "VALUE", productId: null, brandId: null, userId: { in: ids } }, select: { userId: true, goal: true } }),
  ]);
  const orderOf = new Map(orders.map((o) => [o.placedById!, o]));
  const payOf = new Map(pays.map((x) => [x.collectedById!, x._sum.amount ?? 0]));
  const cashOf = new Map(cash.map((x) => [x.collectedById!, x._sum.amount ?? 0]));
  const goalOf = new Map(targets.map((t) => [t.userId, t.goal]));
  // Target achievement is for the whole month, so it is read from the month's orders.
  const monthStart = istDayRange(`${month}-01`).from;
  const monthOrders = targets.length
    ? await tx.order.groupBy({ by: ["placedById"], where: { placedById: { in: targets.map((t) => t.userId) }, createdAt: { gte: monthStart, lt: p.end }, status: { not: "CANCELLED" } }, _sum: { totalAmount: true } })
    : [];
  const monthOf = new Map(monthOrders.map((o) => [o.placedById!, o._sum.totalAmount ?? 0]));

  const sales = staff
    .filter((s) => s.role !== "DELIVERY_AGENT")
    .map((s) => {
      const mine = visits.filter((v) => v.salesAgent.userId === s.id);
      const productive = mine.filter((v) => v.outcome === "ORDER").length;
      const o = orderOf.get(s.id);
      const goal = goalOf.get(s.id) ?? null;
      return {
        userId: s.id,
        name: s.name,
        role: s.role,
        orders: o?._count ?? 0,
        value: o?._sum.totalAmount ?? 0,
        visits: mine.length,
        productive,
        strikeRate: rate(productive, mine.length),
        shops: new Set(mine.map((v) => v.retailerId)).size,
        collected: payOf.get(s.id) ?? 0,
        target: goal ? { month, goal, achieved: monthOf.get(s.id) ?? 0, pct: pctOf(monthOf.get(s.id) ?? 0, goal) } : null,
      };
    })
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));

  const drivers = staff
    .filter((s) => s.deliveryAgentProfile)
    .map((s) => {
      const mine = drops.filter((d) => d.deliveryAgentId === s.deliveryAgentProfile!.id);
      const done = mine.filter((d) => d.state === "DELIVERED");
      const promised = done.filter((d) => d.order.deliveryDate);
      const onTime = promised.filter((d) => istDay(d.deliveredAt!) <= d.order.deliveryDate!.toISOString().slice(0, 10)).length;
      return {
        userId: s.id,
        name: s.name,
        delivered: done.length,
        failed: mine.length - done.length,
        successRate: rate(done.length, mine.length),
        onTimeRate: rate(onTime, promised.length),
        trips: new Set(done.map((d) => d.tripId).filter(Boolean)).size,
        cash: cashOf.get(s.id) ?? 0,
      };
    })
    .sort((a, b) => b.delivered - a.delivered || a.name.localeCompare(b.name));
  return { month, sales, drivers };
}

// ───────────────────────────── retailers ─────────────────────────────

export type ChurnRisk = "high" | "medium" | "low" | "new" | "none";
export const CHURN_LABEL: Record<ChurnRisk, string> = {
  high: "At risk",
  medium: "Slipping",
  low: "Regular",
  new: "New",
  none: "No orders yet",
};

/**
 * How likely a shop has stopped ordering, from its own rhythm.
 * usualGap = average days between its orders in the look-back window.
 * - no orders: none
 * - one order: new (up to 30 days), else high
 * - days since last ≥ 3× the usual gap (and over 14 days): high
 * - ≥ 1.8× (and over 7 days): medium
 * - else low
 */
export function churnRisk(orders: number, usualGap: number | null, daysSince: number | null): ChurnRisk {
  if (!orders || daysSince === null) return "none";
  if (orders === 1 || usualGap === null) return daysSince <= 30 ? "new" : "high";
  const gap = Math.max(usualGap, 3);
  if (daysSince >= 3 * gap && daysSince > 14) return "high";
  if (daysSince >= 1.8 * gap && daysSince > 7) return "medium";
  return "low";
}

/** Look-back for a shop's rhythm. */
export const RHYTHM_DAYS = 180;

export type RetailerRow = {
  retailerId: string;
  outletName: string;
  area: string;
  agent: string | null;
  orders: number;
  value: number;
  avgOrder: number;
  prevValue: number;
  change: number | null;
  perMonth: number;
  usualGap: number | null;
  lastOrder: string | null;
  daysSince: number | null;
  risk: ChurnRisk;
  outstanding: number;
};

export async function retailerAnalytics(tx: Tx, p: Period, opts: { areaId?: string; salesAgentId?: string } = {}) {
  const prev = previousPeriod(p);
  const lookFrom = new Date(p.end.getTime() - RHYTHM_DAYS * DAY);
  const shopWhere: Prisma.RetailerProfileWhereInput = { ...(opts.areaId ? { areaId: opts.areaId } : {}), ...(opts.salesAgentId ? { salesAgentId: opts.salesAgentId } : {}), user: { active: true } };
  const [shops, rhythm, now, before, owed] = await Promise.all([
    tx.retailerProfile.findMany({ where: shopWhere, select: { id: true, outletName: true, area: { select: { name: true } }, salesAgent: { select: { user: { select: { name: true } } } } } }),
    tx.order.groupBy({ by: ["retailerId"], where: { status: { not: "CANCELLED" }, createdAt: { gte: lookFrom, lt: p.end } }, _count: true, _min: { createdAt: true }, _max: { createdAt: true } }),
    tx.order.groupBy({ by: ["retailerId"], where: { status: { not: "CANCELLED" }, createdAt: range(p) }, _count: true, _sum: { totalAmount: true } }),
    tx.order.groupBy({ by: ["retailerId"], where: { status: { not: "CANCELLED" }, createdAt: range(prev) }, _sum: { totalAmount: true } }),
    tx.bill.groupBy({ by: ["retailerId"], where: { settled: false }, _sum: { amount: true, paid: true } }),
  ]);
  // Shops whose last order is older than the look-back still have a "last order".
  const old = await tx.order.groupBy({ by: ["retailerId"], where: { status: { not: "CANCELLED" }, createdAt: { lt: lookFrom }, retailerId: { notIn: rhythm.map((r) => r.retailerId) } }, _max: { createdAt: true } });
  const rh = new Map(rhythm.map((r) => [r.retailerId, r]));
  const oldOf = new Map(old.map((r) => [r.retailerId, r._max.createdAt!]));
  const nowOf = new Map(now.map((r) => [r.retailerId, r]));
  const prevOf = new Map(before.map((r) => [r.retailerId, r._sum.totalAmount ?? 0]));
  const owedOf = new Map(owed.map((r) => [r.retailerId, (r._sum.amount ?? 0) - (r._sum.paid ?? 0)]));
  const asOf = istDayRange(p.to).from.getTime();
  const daysTo = (d: Date) => Math.max(0, Math.round((asOf - istDayRange(istDay(d)).from.getTime()) / DAY));

  const rows: RetailerRow[] = shops.map((s) => {
    const r = rh.get(s.id);
    const n = nowOf.get(s.id);
    const last = r?._max.createdAt ?? oldOf.get(s.id) ?? null;
    const count = r?._count ?? 0;
    const usualGap = r && count > 1 ? Math.round(((r._max.createdAt!.getTime() - r._min.createdAt!.getTime()) / DAY / (count - 1)) * 10) / 10 : null;
    const daysSince = last ? daysTo(last) : null;
    const value = n?._sum.totalAmount ?? 0;
    const prevValue = prevOf.get(s.id) ?? 0;
    return {
      retailerId: s.id,
      outletName: s.outletName,
      area: s.area.name,
      agent: s.salesAgent?.user.name ?? null,
      orders: n?._count ?? 0,
      value,
      avgOrder: n?._count ? Math.round(value / n._count) : 0,
      prevValue,
      change: change(value, prevValue),
      perMonth: Math.round((count * 30 * 10) / RHYTHM_DAYS) / 10,
      usualGap,
      lastOrder: last ? istDay(last) : null,
      daysSince,
      // Rhythm needs orders in the look-back; a shop silent for longer is at risk.
      risk: count ? churnRisk(count, usualGap, daysSince) : last ? "high" : "none",
      outstanding: Math.max(0, owedOf.get(s.id) ?? 0),
    };
  });
  const counts = { high: 0, medium: 0, low: 0, new: 0, none: 0 } as Record<ChurnRisk, number>;
  for (const r of rows) counts[r.risk]++;
  const ordering = rows.filter((r) => r.orders > 0);
  return {
    shops: rows.length,
    ordering: ordering.length,
    avgOrder: ordering.length ? Math.round(ordering.reduce((a, r) => a + r.value, 0) / ordering.reduce((a, r) => a + r.orders, 0)) : 0,
    risk: counts,
    atRiskValue: rows.filter((r) => r.risk === "high" || r.risk === "medium").reduce((a, r) => a + r.prevValue, 0),
    rows,
  };
}

/** One shop: rhythm, month trend, what it buys, money owed and returns. */
export async function retailerDetail(tx: Tx, retailerId: string, p: Period, now = new Date()) {
  const shop = await tx.retailerProfile.findUnique({
    where: { id: retailerId },
    select: { id: true, outletName: true, createdAt: true, creditLimit: true, area: { select: { name: true } }, salesAgent: { select: { user: { select: { name: true } } } }, user: { select: { name: true, phone: true } } },
  });
  if (!shop) throw new MoneyError("Shop not found", 404);
  const lookFrom = new Date(p.end.getTime() - RHYTHM_DAYS * DAY);
  const [list, orders, mix, money, credits, visits] = await Promise.all([
    retailerAnalytics(tx, p).then((r) => r.rows.find((x) => x.retailerId === retailerId) ?? null),
    tx.order.findMany({ where: { retailerId, status: { not: "CANCELLED" }, createdAt: { gte: lookFrom, lt: p.end } }, select: { createdAt: true, totalAmount: true }, orderBy: { createdAt: "asc" } }),
    productMix(tx, p, { retailerId }),
    outstanding(tx, now, { top: 1, where: { retailerId } }),
    tx.invoice.aggregate({ where: { retailerId, type: "CREDIT_NOTE", date: range(p) }, _sum: { total: true }, _count: true }),
    tx.visit.count({ where: { retailerId, checkInAt: range(p) } }),
  ]);
  // Every month of the look-back, empty ones too (a shop going quiet should show as a drop).
  const months = new Map<string, { value: number; orders: number }>();
  for (let d = istDay(lookFrom); d.slice(0, 7) <= p.to.slice(0, 7); d = addDay(`${d.slice(0, 7)}-01`, 32)) months.set(d.slice(0, 7), { value: 0, orders: 0 });
  for (const o of orders) {
    const m = istMonth(o.createdAt);
    const x = months.get(m) ?? { value: 0, orders: 0 };
    x.value += o.totalAmount;
    x.orders++;
    months.set(m, x);
  }
  const sales = await tx.invoice.aggregate({ where: { retailerId, type: { in: SALE_TYPES }, date: range(p) }, _sum: { total: true } });
  const sold = sales._sum.total ?? 0;
  return {
    shop: { id: shop.id, outletName: shop.outletName, owner: shop.user.name, phone: shop.user.phone, area: shop.area.name, agent: shop.salesAgent?.user.name ?? null, since: istDay(shop.createdAt), creditLimit: shop.creditLimit },
    summary: list,
    trend: [...months.entries()].map(([month, x]) => ({ month, ...x })),
    mix: { categories: mix.categories, products: mix.products.slice(0, 15), total: mix.total },
    money: { outstanding: money.total, overdue: money.overdue, ageing: money.ageing },
    returns: { notes: credits._count, value: credits._sum.total ?? 0, rate: rate(credits._sum.total ?? 0, sold) },
    visits,
  };
}

// ───────────────────────────── cost of goods ─────────────────────────────

type CostLine = { invoiceId: string; productId: string | null; orderItemId: string | null; quantity: number; freeQty: number; taxable: number };

/**
 * Cost of each invoice line: the average cost of the stock that went out for
 * that order line (SALE moves minus RETURN moves), else the product's last cost.
 */
async function lineCosts(tx: Tx, lines: CostLine[]) {
  const itemIds = [...new Set(lines.map((l) => l.orderItemId).filter(Boolean))] as string[];
  const productIds = [...new Set(lines.map((l) => l.productId).filter(Boolean))] as string[];
  const [moves, products] = await Promise.all([
    itemIds.length ? tx.stockMove.findMany({ where: { orderItemId: { in: itemIds }, kind: "SALE" }, select: { orderItemId: true, qty: true, unitCost: true } }) : [],
    productIds.length ? tx.product.findMany({ where: { id: { in: productIds } }, select: { id: true, lastCost: true } }) : [],
  ]);
  const avg = new Map<string, { qty: number; cost: number }>();
  for (const m of moves) {
    if (m.unitCost == null) continue;
    const a = avg.get(m.orderItemId!) ?? { qty: 0, cost: 0 };
    a.qty += m.qty;
    a.cost += m.qty * m.unitCost;
    avg.set(m.orderItemId!, a);
  }
  const last = new Map(products.map((x) => [x.id, x.lastCost]));
  return (l: CostLine): number | null => {
    const a = l.orderItemId ? avg.get(l.orderItemId) : undefined;
    const unit = a && a.qty ? a.cost / a.qty : l.productId ? (last.get(l.productId) ?? null) : null;
    return unit == null ? null : Math.round(unit * (l.quantity + l.freeQty));
  };
}

// ───────────────────────────── routes ─────────────────────────────

/**
 * Profit by area (the route a shop is on) and by trip: net taxable sales,
 * cost of goods, gross margin, delivery cost (settings.reports) and what is left.
 */
export async function routeProfitability(tx: Tx, p: Period, costs: Pick<ReportSettings, "tripCost" | "dropCost">) {
  const invoices = await tx.invoice.findMany({
    where: { date: range(p) },
    select: { id: true, type: true, noteKind: true, taxable: true, retailerId: true, orderId: true, lines: { select: { productId: true, orderItemId: true, quantity: true, freeQty: true, taxable: true } } },
  });
  const allLines = invoices.flatMap((i) => i.lines.map((l) => ({ ...l, invoiceId: i.id })));
  const costOf = await lineCosts(tx, allLines);
  const shops = await tx.retailerProfile.findMany({ select: { id: true, areaId: true, area: { select: { name: true } } } });
  const areaOf = new Map(shops.map((s) => [s.id, { id: s.areaId, name: s.area.name }]));

  type Acc = { revenue: number; cogs: number; uncosted: number; drops: number; deliveryCost: number; shops: Set<string> };
  const blank = (): Acc => ({ revenue: 0, cogs: 0, uncosted: 0, drops: 0, deliveryCost: 0, shops: new Set() });
  const areas = new Map<string, Acc & { name: string }>();
  const byOrder = new Map<string, { revenue: number; cogs: number }>();
  const areaAcc = (retailerId: string) => {
    const a = areaOf.get(retailerId) ?? { id: "none", name: "No area" };
    let x = areas.get(a.id);
    if (!x) areas.set(a.id, (x = { ...blank(), name: a.name }));
    return x;
  };

  for (const inv of invoices) {
    const sign = inv.type === "CREDIT_NOTE" ? -1 : 1;
    const x = areaAcc(inv.retailerId);
    x.revenue += sign * inv.taxable;
    if (sign > 0) x.shops.add(inv.retailerId);
    // Goods come back only on return / cancel notes; value notes and debit notes move no stock.
    const movesGoods = inv.type !== "DEBIT_NOTE" && (sign > 0 || inv.noteKind === "return" || inv.noteKind === "cancel");
    let cogs = 0;
    if (movesGoods) {
      for (const l of inv.lines) {
        const c = costOf({ ...l, invoiceId: inv.id });
        if (c == null) {
          if (l.productId) x.uncosted += sign * l.taxable;
          continue;
        }
        cogs += sign * c;
      }
    }
    x.cogs += cogs;
    if (inv.orderId) {
      const o = byOrder.get(inv.orderId) ?? { revenue: 0, cogs: 0 };
      o.revenue += sign * inv.taxable;
      o.cogs += cogs;
      byOrder.set(inv.orderId, o);
    }
  }

  // Delivery cost: per drop, plus each trip's cost spread over its drops.
  const drops = await tx.delivery.findMany({ where: { state: "DELIVERED", deliveredAt: range(p) }, select: { orderId: true, tripId: true, order: { select: { retailerId: true } } } });
  const perTrip = new Map<string, number>();
  for (const d of drops) if (d.tripId) perTrip.set(d.tripId, (perTrip.get(d.tripId) ?? 0) + 1);
  for (const d of drops) {
    const x = areaAcc(d.order.retailerId);
    x.drops++;
    x.deliveryCost += costs.dropCost + (d.tripId ? costs.tripCost / perTrip.get(d.tripId)! : 0);
  }

  const areaRows = [...areas.entries()]
    .map(([areaId, x]) => {
      const margin = x.revenue - x.cogs;
      const deliveryCost = Math.round(x.deliveryCost);
      return {
        areaId,
        name: x.name,
        revenue: x.revenue,
        cogs: x.cogs,
        margin,
        marginPct: share(margin, x.revenue),
        deliveryCost,
        contribution: margin - deliveryCost,
        drops: x.drops,
        shops: x.shops.size,
        perDrop: x.drops ? Math.round(x.revenue / x.drops) : 0,
        uncosted: x.uncosted,
      };
    })
    .filter((r) => r.revenue || r.drops)
    .sort((a, b) => b.contribution - a.contribution);

  const tripIds = [...perTrip.keys()];
  const trips = tripIds.length
    ? await tx.trip.findMany({ where: { id: { in: tripIds } }, select: { id: true, number: true, date: true, slot: true, driver: { select: { user: { select: { name: true } } } }, vehicle: { select: { number: true } } }, orderBy: { date: "desc" } })
    : [];
  const tripRows = trips.map((t) => {
    const mine = drops.filter((d) => d.tripId === t.id);
    const revenue = mine.reduce((a, d) => a + (byOrder.get(d.orderId)?.revenue ?? 0), 0);
    const cogs = mine.reduce((a, d) => a + (byOrder.get(d.orderId)?.cogs ?? 0), 0);
    const deliveryCost = costs.tripCost + costs.dropCost * mine.length;
    return {
      tripId: t.id,
      number: t.number,
      date: t.date.toISOString().slice(0, 10),
      slot: t.slot,
      driver: t.driver.user.name,
      vehicle: t.vehicle?.number ?? null,
      drops: mine.length,
      revenue,
      margin: revenue - cogs,
      deliveryCost,
      contribution: revenue - cogs - deliveryCost,
    };
  });
  const totals = areaRows.reduce((a, r) => ({ revenue: a.revenue + r.revenue, cogs: a.cogs + r.cogs, margin: a.margin + r.margin, deliveryCost: a.deliveryCost + r.deliveryCost, contribution: a.contribution + r.contribution, drops: a.drops + r.drops, uncosted: a.uncosted + r.uncosted }), { revenue: 0, cogs: 0, margin: 0, deliveryCost: 0, contribution: 0, drops: 0, uncosted: 0 });
  return { costs, totals: { ...totals, marginPct: share(totals.margin, totals.revenue) }, areas: areaRows, trips: tripRows.slice(0, 60) };
}

// ───────────────────────────── schemes ─────────────────────────────

/**
 * Scheme ROI. Cost = discount / free goods given (redemptions, not reversed).
 * Sales on scheme orders, and uplift: how much more the shops that used the
 * scheme bought than in the period before, after taking off the growth the
 * shops that used no scheme had anyway (the control). ROI = extra sales ÷ cost.
 * With no control shops (every shop used a scheme, or none bought before),
 * or when the business's records start inside the period before, extra and
 * ROI are null: there is nothing fair to compare with.
 */
export async function schemeRoi(tx: Tx, p: Period) {
  const prev = previousPeriod(p);
  const reds = await tx.schemeRedemption.findMany({ where: { reversed: false, createdAt: range(p) }, select: { schemeId: true, orderId: true, retailerId: true, value: true, freeQty: true } });
  const schemeIds = [...new Set(reds.map((r) => r.schemeId))];
  const [schemes, nowSales, prevSales] = await Promise.all([
    schemeIds.length ? tx.scheme.findMany({ where: { id: { in: schemeIds } }, select: { id: true, name: true, type: true, budget: true, spent: true, startsAt: true, endsAt: true, active: true } }) : [],
    tx.order.groupBy({ by: ["retailerId"], where: { status: { not: "CANCELLED" }, createdAt: range(p) }, _sum: { totalAmount: true } }),
    tx.order.groupBy({ by: ["retailerId"], where: { status: { not: "CANCELLED" }, createdAt: range(prev) }, _sum: { totalAmount: true } }),
  ]);
  const orderIds = [...new Set(reds.map((r) => r.orderId))];
  const orders = orderIds.length ? await tx.order.findMany({ where: { id: { in: orderIds }, status: { not: "CANCELLED" } }, select: { id: true, totalAmount: true } }) : [];
  const orderValue = new Map(orders.map((o) => [o.id, o.totalAmount]));
  const nowOf = new Map(nowSales.map((r) => [r.retailerId, r._sum.totalAmount ?? 0]));
  const prevOf = new Map(prevSales.map((r) => [r.retailerId, r._sum.totalAmount ?? 0]));
  const users = new Set(reds.map((r) => r.retailerId));
  const sumOf = (m: Map<string, number>, keep: (id: string) => boolean) => [...m.entries()].filter(([id]) => keep(id)).reduce((a, [, v]) => a + v, 0);
  const controlNow = sumOf(nowOf, (id) => !users.has(id));
  const controlPrev = sumOf(prevOf, (id) => !users.has(id));
  // Records that start inside the period before make every shop look like it grew.
  const fullHistory = !!(await tx.order.findFirst({ where: { createdAt: { lt: prev.start } }, select: { id: true } }));
  const controlGrowth = controlPrev && fullHistory ? controlNow / controlPrev - 1 : null;

  const rows = schemes.map((s) => {
    const mine = reds.filter((r) => r.schemeId === s.id);
    const shops = new Set(mine.map((r) => r.retailerId));
    const ords = new Set(mine.map((r) => r.orderId));
    const cost = mine.reduce((a, r) => a + r.value, 0);
    const sales = [...ords].reduce((a, id) => a + (orderValue.get(id) ?? 0), 0);
    const before = sumOf(prevOf, (id) => shops.has(id));
    const after = sumOf(nowOf, (id) => shops.has(id));
    const extra = controlGrowth === null || !before ? null : after - Math.round(before * (1 + controlGrowth));
    return {
      schemeId: s.id,
      name: s.name,
      type: s.type,
      active: s.active,
      cost,
      freeQty: mine.reduce((a, r) => a + r.freeQty, 0),
      orders: ords.size,
      shops: shops.size,
      sales,
      salesPerRupee: cost ? Math.round((sales / cost) * 10) / 10 : null,
      before,
      after,
      uplift: change(after, before),
      extra,
      roi: cost && extra !== null ? Math.round((extra / cost) * 10) / 10 : null,
      budget: s.budget,
      budgetUsed: s.budget ? share(s.spent, s.budget) : null,
    };
  });
  return {
    controlGrowth: controlGrowth === null ? null : Math.round(controlGrowth * 1000) / 10,
    fullHistory,
    controlShops: [...nowOf.keys(), ...prevOf.keys()].filter((id, i, a) => !users.has(id) && a.indexOf(id) === i).length,
    totals: { cost: rows.reduce((a, r) => a + r.cost, 0), sales: rows.reduce((a, r) => a + r.sales, 0), extra: rows.some((r) => r.extra !== null) ? rows.reduce((a, r) => a + (r.extra ?? 0), 0) : null },
    schemes: rows.sort((a, b) => b.cost - a.cost),
  };
}

// ───────────────────────────── returns and damage ─────────────────────────────

export const NOTE_KIND_LABEL: Record<string, string> = { return: "Goods returned", value: "Rate or discount change", cancel: "Invoice cancelled" };

export async function returnsAndDamage(tx: Tx, p: Period) {
  const [sales, notes, noteLines, saleLines, damage, writeOff, shortItems] = await Promise.all([
    salesTotals(tx, p),
    tx.invoice.findMany({ where: { type: "CREDIT_NOTE", date: range(p) }, select: { noteKind: true, reason: true, total: true, retailerId: true } }),
    tx.invoiceLine.groupBy({ by: ["productId"], where: { productId: { not: null }, invoice: { type: "CREDIT_NOTE", noteKind: { in: ["return", "cancel"] }, date: range(p) } }, _sum: { quantity: true, total: true } }),
    tx.invoiceLine.groupBy({ by: ["productId"], where: { productId: { not: null }, invoice: { type: { in: SALE_TYPES }, date: range(p) } }, _sum: { quantity: true } }),
    tx.stockMove.findMany({ where: { kind: "DAMAGE", createdAt: range(p) }, select: { productId: true, qty: true, unitCost: true, reason: true } }),
    tx.stockMove.findMany({ where: { kind: "WRITE_OFF", createdAt: range(p) }, select: { productId: true, qty: true, unitCost: true } }),
    tx.orderItem.findMany({ where: { order: { delivery: { deliveredAt: range(p) } }, orderedQty: { not: null }, deliveredQty: { not: null } }, select: { productId: true, orderedQty: true, deliveredQty: true, price: true, shortReason: true } }),
  ]);
  const short = shortItems.filter((l) => (l.deliveredQty ?? 0) < (l.orderedQty ?? 0));
  const productIds = [...new Set([...noteLines.map((l) => l.productId!), ...damage.map((m) => m.productId), ...writeOff.map((m) => m.productId), ...short.map((l) => l.productId)])];
  const products = productIds.length ? await tx.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true, lastCost: true } }) : [];
  const prod = new Map(products.map((x) => [x.id, x]));
  const moveValue = (m: { productId: string; qty: number; unitCost: number | null }) => m.qty * (m.unitCost ?? prod.get(m.productId)?.lastCost ?? 0);

  const kinds = new Map<string, { count: number; value: number }>();
  const reasons = new Map<string, { count: number; value: number }>();
  const shopNotes = new Map<string, number>();
  for (const n of notes) {
    const k = n.noteKind ?? "value";
    const a = kinds.get(k) ?? { count: 0, value: 0 };
    a.count++;
    a.value += n.total;
    kinds.set(k, a);
    const r = (n.reason ?? "").trim() || "No reason given";
    const b = reasons.get(r) ?? { count: 0, value: 0 };
    b.count++;
    b.value += n.total;
    reasons.set(r, b);
    shopNotes.set(n.retailerId, (shopNotes.get(n.retailerId) ?? 0) + n.total);
  }
  const shortReasons = new Map<string, { lines: number; qty: number; value: number }>();
  for (const l of short) {
    const k = l.shortReason ?? "other";
    const q = (l.orderedQty ?? 0) - (l.deliveredQty ?? 0);
    const a = shortReasons.get(k) ?? { lines: 0, qty: 0, value: 0 };
    a.lines++;
    a.qty += q;
    a.value += q * l.price;
    shortReasons.set(k, a);
  }
  const damageReasons = new Map<string, { qty: number; value: number }>();
  for (const m of damage) {
    const k = m.reason ?? "damaged";
    const a = damageReasons.get(k) ?? { qty: 0, value: 0 };
    a.qty += m.qty;
    a.value += moveValue(m);
    damageReasons.set(k, a);
  }

  // Per product: sold, returned, short, damaged.
  const sold = new Map(saleLines.map((l) => [l.productId!, l._sum.quantity ?? 0]));
  const per = new Map<string, { returned: number; short: number; damaged: number; value: number }>();
  const bump = (id: string, k: "returned" | "short" | "damaged", q: number, v: number) => {
    const a = per.get(id) ?? { returned: 0, short: 0, damaged: 0, value: 0 };
    a[k] += q;
    a.value += v;
    per.set(id, a);
  };
  for (const l of noteLines) bump(l.productId!, "returned", l._sum.quantity ?? 0, l._sum.total ?? 0);
  for (const l of short) bump(l.productId, "short", (l.orderedQty ?? 0) - (l.deliveredQty ?? 0), ((l.orderedQty ?? 0) - (l.deliveredQty ?? 0)) * l.price);
  for (const m of damage) bump(m.productId, "damaged", m.qty, moveValue(m));
  const productRows = [...per.entries()]
    .map(([productId, a]) => {
      const s = sold.get(productId) ?? 0;
      return { productId, name: prod.get(productId)?.name ?? "Removed product", sold: s, ...a, rate: share(a.returned + a.short, s + a.short) };
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, 20);

  const shopIds = [...shopNotes.keys()];
  const shopSales = shopIds.length ? await tx.invoice.groupBy({ by: ["retailerId"], where: { retailerId: { in: shopIds }, type: { in: SALE_TYPES }, date: range(p) }, _sum: { total: true } }) : [];
  const shopNames = shopIds.length ? await tx.retailerProfile.findMany({ where: { id: { in: shopIds } }, select: { id: true, outletName: true } }) : [];
  const soldTo = new Map(shopSales.map((x) => [x.retailerId, x._sum.total ?? 0]));
  const shopRows = shopIds
    .map((id) => ({ retailerId: id, outletName: shopNames.find((s) => s.id === id)?.outletName ?? "", credited: shopNotes.get(id)!, sales: soldTo.get(id) ?? 0, rate: share(shopNotes.get(id)!, soldTo.get(id) ?? 0) }))
    .sort((a, b) => b.credited - a.credited)
    .slice(0, 15);

  const returned = (kinds.get("return")?.value ?? 0) + (kinds.get("cancel")?.value ?? 0);
  const damageValue = damage.reduce((a, m) => a + moveValue(m), 0);
  return {
    sales: sales.gross,
    credits: sales.credits,
    returnRate: share(returned, sales.gross),
    creditRate: share(sales.credits, sales.gross),
    noteKinds: [...kinds.entries()].map(([key, a]) => ({ key, label: NOTE_KIND_LABEL[key] ?? key, ...a })).sort((a, b) => b.value - a.value),
    reasons: [...reasons.entries()].map(([reason, a]) => ({ reason, ...a })).sort((a, b) => b.value - a.value).slice(0, 10),
    short: {
      lines: short.length,
      value: short.reduce((a, l) => a + ((l.orderedQty ?? 0) - (l.deliveredQty ?? 0)) * l.price, 0),
      reasons: [...shortReasons.entries()].map(([key, a]) => ({ key, label: SHORT_REASONS[key as keyof typeof SHORT_REASONS] ?? key, ...a })).sort((a, b) => b.value - a.value),
    },
    damage: {
      qty: damage.reduce((a, m) => a + m.qty, 0),
      value: damageValue,
      rate: share(damageValue, sales.netTaxable),
      reasons: [...damageReasons.entries()].map(([key, a]) => ({ key, ...a })).sort((a, b) => b.value - a.value),
      writtenOff: writeOff.reduce((a, m) => a + moveValue(m), 0),
    },
    products: productRows,
    shops: shopRows,
  };
}

// ───────────────────────────── owner dashboard ─────────────────────────────

export async function ownerDashboard(tx: Tx, p: Period, now = new Date()) {
  const prev = previousPeriod(p);
  const [sales, salesPrev, orders, ordersPrev, money, moneyPrev, owed, stock, delivery, team, days, mix] = await Promise.all([
    salesTotals(tx, p),
    salesTotals(tx, prev),
    orderTotals(tx, p),
    orderTotals(tx, prev),
    collections(tx, p),
    collections(tx, prev),
    outstanding(tx, now, { top: 8 }),
    stockValue(tx, now),
    deliveryPerformance(tx, p),
    agentPerformance(tx, p),
    salesByDay(tx, p),
    productMix(tx, p),
  ]);
  return {
    period: { from: p.from, to: p.to, days: p.days },
    previous: { from: prev.from, to: prev.to },
    sales: { ...sales, change: change(sales.net, salesPrev.net), prev: salesPrev.net },
    orders: { ...orders, change: change(orders.value, ordersPrev.value), prev: ordersPrev.value },
    collections: { ...money, change: change(money.received, moneyPrev.received), prev: moneyPrev.received },
    outstanding: { ...owed, dso: sales.net ? Math.round((owed.total / (sales.net / p.days)) * 10) / 10 : null },
    stock,
    delivery,
    team: { month: team.month, sales: team.sales.slice(0, 8), drivers: team.drivers.slice(0, 8) },
    byDay: days,
    categories: mix.categories.slice(0, 8),
    topProducts: mix.products.slice(0, 8),
  };
}

// ───────────────────────────── daily summary ─────────────────────────────

/** The figures for the evening message to the owner (one IST day). */
export async function dailySummary(tx: Tx, day: string, now = new Date()) {
  const p = makePeriod(day, day);
  const [sales, orders, money, owed, delivery, waiting] = await Promise.all([
    salesTotals(tx, p),
    orderTotals(tx, p),
    collections(tx, p),
    outstanding(tx, now, { top: 0 }),
    deliveryPerformance(tx, p),
    tx.order.count({ where: { status: "PLACED" } }),
  ]);
  const cash = money.byMethod.find((m) => m.method === "CASH")?.amount ?? 0;
  return {
    day,
    sales: sales.net,
    orders: orders.count,
    orderValue: orders.value,
    collected: money.received,
    cash,
    online: money.received - cash,
    delivered: delivery.delivered,
    failed: delivery.failed,
    outstanding: owed.total,
    overdue: owed.overdue,
    waiting,
    pendingPayments: money.pending.count,
  };
}
