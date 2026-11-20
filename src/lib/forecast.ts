/**
 * A6: demand forecast, next-day load sheet and reorder suggestions to
 * suppliers (roadmap §7). Plain maths on the business's own orders
 * (lib/forecast-math.ts). The reorder review writes a Suggestion per
 * supplier; accepting it makes a DRAFT purchase order that someone still
 * checks and sends. Nothing is bought by itself.
 */
import type { Prisma } from "@/generated/prisma/client";
import type { Ctx } from "@/lib/ledger";
import { MoneyError } from "@/lib/ledger";
import { addDay, istDay, istDayRange, weekday } from "@/lib/field-math";
import { createPo, stockLevels, stockSettings } from "@/lib/stock";
import { reorderSuggestion } from "@/lib/stock-math";
import { hasFeature } from "@/lib/plans";
import type { AutomationSettings } from "@/lib/automation-settings";
import { HISTORY_DAYS, forecastDemand, loadSuggestion, reorderNeed, type Forecast } from "@/lib/forecast-math";
import { suggest } from "@/lib/suggest";

type Tx = Ctx["tx"];
const DAY_MS = 86_400_000;
const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });

/**
 * Daily demand per product: units on non-cancelled orders by the IST day they
 * were placed, for the HISTORY_DAYS days before `today` (today is left out:
 * it isn't over). Every day is present, zeros included.
 */
export async function demandHistory(tx: Tx, today: string, productIds?: string[]) {
  const first = addDay(today, -HISTORY_DAYS);
  const days = Array.from({ length: HISTORY_DAYS }, (_, i) => addDay(first, i));
  const rows = await tx.$queryRaw<{ productId: string; day: string; qty: bigint }[]>`
    SELECT oi."productId" AS "productId",
           to_char(o."createdAt" + interval '330 minutes', 'YYYY-MM-DD') AS day,
           COALESCE(SUM(COALESCE(oi."orderedQty", oi.quantity)), 0)::bigint AS qty
    FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId"
    WHERE o.status <> 'CANCELLED' AND o."createdAt" >= ${istDayRange(first).from} AND o."createdAt" < ${istDayRange(today).from}
    GROUP BY 1, 2`;
  const index = new Map(days.map((d, i) => [d, i]));
  const only = productIds ? new Set(productIds) : null;
  const series = new Map<string, number[]>();
  for (const r of rows) {
    if (only && !only.has(r.productId)) continue;
    const i = index.get(r.day);
    if (i === undefined) continue;
    let s = series.get(r.productId);
    if (!s) series.set(r.productId, (s = new Array(HISTORY_DAYS).fill(0)));
    s[i] += Number(r.qty);
  }
  return { days, weekdays: days.map(weekday), series };
}

/** Forecast for every product with demand in the history (or the ones asked for), for `targetDay`'s weekday. */
export async function forecasts(tx: Tx, today: string, targetDay: string, productIds?: string[]) {
  const h = await demandHistory(tx, today, productIds);
  const wd = weekday(targetDay);
  const out = new Map<string, Forecast>();
  for (const [id, s] of h.series) out.set(id, forecastDemand(s, h.weekdays, wd));
  return out;
}

// ---------- next-day load sheet ----------

export type LoadSheetRow = {
  productId: string;
  name: string;
  sku: string;
  unit: string;
  caseSize: number | null;
  category: string;
  /** On orders going out that day. */
  booked: number;
  /** Usual demand for that weekday (forecast). */
  usual: number;
  extra: number;
  suggested: number;
  /** Sellable in warehouses now (null when stock isn't tracked). */
  warehouse: number | null;
  short: number;
};

/**
 * What to pick for `date`: the orders going out that day (the dispatch
 * board's ready orders, plus those on trips not yet started) and, when topUp
 * is on, extra up to the usual for that weekday for spot sales and late orders.
 */
export async function loadSheet(ctx: Ctx, date: string, now: Date, s: AutomationSettings) {
  const tx = ctx.tx;
  const orders = await tx.order.findMany({
    where: {
      status: { in: ["PLACED", "CONFIRMED", "PACKED"] },
      NOT: { AND: [{ creditHold: true }, { creditApprovedAt: null }] },
      AND: [
        { OR: [{ deliveryDate: null }, { deliveryDate: { lte: new Date(`${date}T00:00:00Z`) } }] },
        { OR: [{ delivery: null }, { delivery: { tripId: null } }, { delivery: { trip: { status: { in: ["PLANNED", "CLOSED"] } } } }] },
      ],
    },
    select: { id: true, items: { select: { productId: true, quantity: true } } },
  });
  const booked = new Map<string, number>();
  for (const o of orders) for (const i of o.items) booked.set(i.productId, (booked.get(i.productId) ?? 0) + i.quantity);

  const fc = s.forecast.on ? await forecasts(tx, istDay(now), date) : new Map<string, Forecast>();
  const ids = [...new Set([...booked.keys(), ...[...fc.entries()].filter(([, f]) => f.forDay >= 0.5).map(([id]) => id)])];
  const [products, stockOn] = await Promise.all([
    tx.product.findMany({ where: { id: { in: ids }, active: true }, select: { id: true, name: true, sku: true, unit: true, caseSize: true, category: { select: { name: true } } } }),
    stockSettings(tx, ctx.tenantId).then((x) => x.enabled),
  ]);
  const levels = stockOn ? await stockLevels(tx, ids) : null;
  const rows: LoadSheetRow[] = [];
  for (const p of products) {
    const b = booked.get(p.id) ?? 0;
    const f = fc.get(p.id);
    const l = loadSuggestion({ booked: b, forDay: f?.forDay ?? 0, topUp: s.forecast.on && s.forecast.topUp, caseSize: p.caseSize });
    if (!l.suggested) continue;
    const wh = levels ? (levels.get(p.id)?.warehouse ?? 0) : null;
    rows.push({
      productId: p.id,
      name: p.name,
      sku: p.sku,
      unit: p.unit,
      caseSize: p.caseSize,
      category: p.category.name,
      booked: b,
      usual: f ? Math.round(f.forDay * 10) / 10 : 0,
      extra: l.extra,
      suggested: l.suggested,
      warehouse: wh,
      short: wh === null ? 0 : Math.max(0, l.suggested - wh),
    });
  }
  rows.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  return {
    date,
    label: dayLabel(date),
    orders: orders.length,
    stockTracked: stockOn,
    topUp: s.forecast.on && s.forecast.topUp,
    rows,
    totals: { booked: rows.reduce((a, r) => a + r.booked, 0), extra: rows.reduce((a, r) => a + r.extra, 0), short: rows.filter((r) => r.short > 0).length },
  };
}

// ---------- forecast table + reorder ----------

export type ForecastRow = {
  productId: string;
  name: string;
  sku: string;
  unit: string;
  caseSize: number | null;
  daily: number;
  sigma: number;
  activeDays: number;
  available: number | null;
  onOrder: number;
  daysLeft: number | null;
  /** The IST day stock runs out at the forecast rate. */
  runsOut: string | null;
  supplierId: string | null;
  supplierName: string | null;
  leadDays: number | null;
  /** Units to order now ((s, S) policy, or the product's reorder level if that asks for more). */
  reorderQty: number;
  runsOutFirst: boolean;
  lastCost: number | null;
};

/** Every active product with demand in the history: forecast, stock cover and what to reorder. */
export async function forecastTable(tx: Tx, tenantId: string, now: Date, s: AutomationSettings) {
  const today = istDay(now);
  const fc = await forecasts(tx, today, today);
  const ids = [...fc.keys()];
  const stockOn = (await stockSettings(tx, tenantId)).enabled;
  const [products, levels, open] = await Promise.all([
    tx.product.findMany({
      where: { id: { in: ids }, active: true },
      select: { id: true, name: true, sku: true, unit: true, caseSize: true, reorderLevel: true, reorderQty: true, lastCost: true, supplier: { select: { id: true, name: true, leadDays: true, active: true } } },
    }),
    stockOn ? stockLevels(tx, ids) : Promise.resolve(null),
    tx.purchaseOrderLine.findMany({ where: { productId: { in: ids }, po: { status: { in: ["DRAFT", "SENT", "PARTLY_RECEIVED"] } } }, select: { productId: true, quantity: true, receivedQty: true } }),
  ]);
  const onOrder = new Map<string, number>();
  for (const l of open) onOrder.set(l.productId, (onOrder.get(l.productId) ?? 0) + Math.max(0, l.quantity - l.receivedQty));
  const rows: ForecastRow[] = products.map((p) => {
    const f = fc.get(p.id)!;
    const supplier = p.supplier?.active ? p.supplier : null;
    const available = levels ? (levels.get(p.id)?.available ?? 0) : null;
    const o = onOrder.get(p.id) ?? 0;
    const need =
      available === null
        ? null
        : reorderNeed({ available, onOrder: o, daily: f.daily, sigma: f.sigma, leadDays: supplier?.leadDays ?? 3, coverDays: s.forecast.coverDays, serviceLevel: s.forecast.serviceLevel, caseSize: p.caseSize });
    const levelRule = available === null ? 0 : reorderSuggestion({ available: available + o, reorderLevel: p.reorderLevel, reorderQty: p.reorderQty, caseSize: p.caseSize });
    return {
      productId: p.id,
      name: p.name,
      sku: p.sku,
      unit: p.unit,
      caseSize: p.caseSize,
      daily: f.daily,
      sigma: f.sigma,
      activeDays: f.activeDays,
      available,
      onOrder: o,
      daysLeft: need?.daysLeft ?? null,
      runsOut: need?.daysLeft !== null && need?.daysLeft !== undefined ? addDay(today, need.daysLeft) : null,
      supplierId: supplier?.id ?? null,
      supplierName: supplier?.name ?? null,
      leadDays: supplier?.leadDays ?? null,
      reorderQty: Math.max(need?.qty ?? 0, levelRule),
      runsOutFirst: need?.runsOutFirst ?? false,
      lastCost: p.lastCost,
    };
  });
  rows.sort((a, b) => (a.daysLeft ?? 1e9) - (b.daysLeft ?? 1e9) || b.daily - a.daily);
  return { today, stockTracked: stockOn, coverDays: s.forecast.coverDays, serviceLevel: s.forecast.serviceLevel, rows };
}

export type ReorderLine = { productId: string; name: string; unit: string; qty: number; unitCost: number | null; available: number; onOrder: number; daily: number; daysLeft: number | null };

/**
 * Daily: one suggestion per supplier with the products to reorder. Needs
 * stock tracking (and the stock module). A supplier with an open reorder
 * suggestion gets no second one; products without a supplier are skipped.
 */
export async function reviewReorder(ctx: Ctx, now: Date, s: AutomationSettings) {
  if (!s.forecast.on) return 0;
  if (!(await hasFeature(ctx.tenantId, "inventory"))) return 0;
  if (!(await stockSettings(ctx.tx, ctx.tenantId)).enabled) return 0;
  const t = await forecastTable(ctx.tx, ctx.tenantId, now, s);
  const bySupplier = new Map<string, ForecastRow[]>();
  for (const r of t.rows) if (r.reorderQty > 0 && r.supplierId) bySupplier.set(r.supplierId, [...(bySupplier.get(r.supplierId) ?? []), r]);
  const openFor = new Set((await ctx.tx.suggestion.findMany({ where: { kind: "reorder", status: "OPEN" }, select: { subjectId: true } })).map((x) => x.subjectId));
  let made = 0;
  for (const [supplierId, rows] of bySupplier) {
    if (openFor.has(supplierId)) continue;
    const first = rows[0];
    const urgent = rows.filter((r) => r.runsOutFirst);
    const lines: ReorderLine[] = rows.map((r) => ({ productId: r.productId, name: r.name, unit: r.unit, qty: r.reorderQty, unitCost: r.lastCost, available: r.available ?? 0, onOrder: r.onOrder, daily: r.daily, daysLeft: r.daysLeft }));
    const value = lines.reduce((a, l) => a + l.qty * (l.unitCost ?? 0), 0);
    const ok = await suggest(ctx.tx, {
      kind: "reorder",
      subjectType: "supplier",
      subjectId: supplierId,
      title: `Order ${rows.length} product${rows.length === 1 ? "" : "s"} from ${first.supplierName}`,
      detail: `Enough for the ${first.leadDays} day${first.leadDays === 1 ? "" : "s"} ${first.supplierName} takes to deliver plus ${t.coverDays} days, with safety stock so it lasts ${t.serviceLevel}% of the time. Accepting makes a draft purchase order to check and send.`,
      reasons: [
        ...(urgent.length ? [`${urgent.length} run${urgent.length === 1 ? "s" : ""} out before the goods would arrive`] : []),
        ...rows.slice(0, 3).map((r) => (r.daysLeft === null ? r.name : `${r.name}: ${r.daysLeft} day${r.daysLeft === 1 ? "" : "s"} left`)),
      ],
      payload: { supplierId, supplierName: first.supplierName, leadDays: first.leadDays, lines, value } as unknown as Prisma.InputJsonValue,
      score: Math.min(95, 40 + urgent.length * 15 + rows.length * 2),
      dedupeKey: `reorder:${supplierId}:${t.today}`,
      expiresAt: new Date(now.getTime() + 3 * DAY_MS),
    });
    if (ok) made++;
  }
  return made;
}

/** Accept a reorder suggestion: a DRAFT purchase order for its lines, expected after the lead time. */
export async function applyReorder(ctx: Ctx, payload: Record<string, unknown>, now: Date) {
  const lines = (payload.lines as ReorderLine[]).filter((l) => l.qty > 0);
  if (!lines.length) throw new MoneyError("Nothing left to order");
  const active = new Set((await ctx.tx.product.findMany({ where: { id: { in: lines.map((l) => l.productId) }, active: true }, select: { id: true } })).map((p) => p.id));
  const keep = lines.filter((l) => active.has(l.productId));
  if (!keep.length) throw new MoneyError("These products are no longer active");
  const po = await createPo(
    ctx,
    {
      supplierId: payload.supplierId as string,
      expectedDate: addDay(istDay(now), Number(payload.leadDays) || 0),
      note: "Drafted from a reorder suggestion",
      lines: keep.map((l) => ({ productId: l.productId, quantity: l.qty, unitCost: l.unitCost })),
    },
    now
  );
  return { poId: po.id, number: po.number, lines: keep.length };
}
