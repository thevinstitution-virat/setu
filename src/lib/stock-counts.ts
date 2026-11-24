import type { Prisma, StockCountMode } from "@/generated/prisma/client";
import { assertBooksOpen, MoneyError, post, type Ctx } from "@/lib/ledger";
import { docNumber, fyCode } from "@/lib/gst";
import { nextSequence } from "@/lib/orders";
import { dayEnd, dayStart, isDay, showDay, todayIst } from "@/lib/books";
import { stockIn, stockOn, stockOut } from "@/lib/stock";
import { formatINR } from "@/lib/money";
import { COUNT_MODE_LABEL, COUNT_STATUS_LABEL, type ValuationBy } from "@/lib/stock-count-labels";

/**
 * Stock valuation and physical counts (A6).
 *
 * The books keep purchases as an expense (periodic stock): closing stock is
 * not an account, it is worked out for the P&L and balance sheet (A7):
 *
 *   - Stock tracking on: the app's stock at cost as at the end of the day:
 *     every batch's quantity × its own cost (else the product's last cost).
 *     Warehouses and vans only; the damaged bin is shown apart, not counted
 *     (its goods are written off or claimed from the company).
 *   - Stock tracking off: the latest accepted count on or before that day.
 *
 * A count at a place (tracking on) is made per batch. Accepting it moves the
 * app's stock to what was counted, as at the end of the count day, and
 * moves the net shortage at cost out of Purchases into Stock shortage
 * (Dr STOCK_LOSS / Cr PURCHASES; an excess the other way). Net profit is
 * unchanged by that entry: it only shows the loss on its own line, since the
 * lower closing stock already carries it.
 */

const MAX_QTY = 1_000_000;
const MAX_RATE = 10_00_00_000; // ₹10 lakh a unit
const MAX_VALUE = 1_000_00_00_00_000; // ₹1,000 crore
const MAX_LINES = 5000;
const SAVE_ROWS = 500;

const dbDay = (d: string) => new Date(`${d}T00:00:00Z`);
const dayText = (d: Date) => d.toISOString().slice(0, 10);
const n = (v: bigint | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const clean = (s: string | null | undefined, max: number) => (s ?? "").trim().slice(0, max);

function wholeQty(v: unknown, what: string) {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > MAX_QTY) throw new MoneyError(`${what} must be a whole number, 0 or more`);
  return v;
}
function paise(v: unknown, what: string, max: number) {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > max) throw new MoneyError(`${what} must be ₹0 or more`);
  return v;
}

// ───────────────────────────── stock as on a day ─────────────────────────────

export type LotOn = { id: string; productId: string; locationId: string; batch: string; expiry: Date | null; mfgDate: Date | null; unitCost: number | null; qtyOn: number };

/**
 * Batches and their quantity at the end of a day: today's quantity less
 * everything that came in after, plus everything that went out after.
 */
export async function lotsOn(ctx: Ctx, day: string, where: Prisma.StockLotWhereInput = {}): Promise<LotOn[]> {
  const lots = await ctx.tx.stockLot.findMany({
    where,
    select: { id: true, productId: true, locationId: true, batch: true, expiry: true, mfgDate: true, unitCost: true, qty: true },
  });
  if (day >= todayIst() || !lots.length) return lots.map(({ qty, ...l }) => ({ ...l, qtyOn: qty }));
  const after = { gt: dayEnd(day) };
  const [inOwn, outOwn, inTo] = await Promise.all([
    ctx.tx.stockMove.groupBy({ by: ["lotId"], where: { createdAt: after, lotId: { not: null }, fromId: null }, _sum: { qty: true } }),
    ctx.tx.stockMove.groupBy({ by: ["lotId"], where: { createdAt: after, lotId: { not: null }, fromId: { not: null } }, _sum: { qty: true } }),
    ctx.tx.stockMove.groupBy({ by: ["toLotId"], where: { createdAt: after, toLotId: { not: null } }, _sum: { qty: true } }),
  ]);
  const later = new Map<string, number>();
  const add = (id: string | null, d: number) => id && later.set(id, (later.get(id) ?? 0) + d);
  for (const r of inOwn) add(r.lotId, r._sum.qty ?? 0);
  for (const r of outOwn) add(r.lotId, -(r._sum.qty ?? 0));
  for (const r of inTo) add(r.toLotId, r._sum.qty ?? 0);
  return lots.map(({ qty, ...l }) => ({ ...l, qtyOn: Math.max(0, qty - (later.get(l.id) ?? 0)) }));
}

// ───────────────────────────── valuation (A6.1) ─────────────────────────────

export type ValuationRow = {
  productId: string;
  name: string;
  sku: string;
  unit: string;
  company: string;
  category: string;
  qty: number;
  value: number;
  /** Units valued at the product's last cost (the batch has no cost), and units with no cost at all. */
  atLastCost: number;
  noCost: number;
};

/** Stock value at cost as at the end of a day, by company, category, place or product. */
export async function stockValuation(ctx: Ctx, o: { day: string; by: ValuationBy; locationId?: string | null; supplierId?: string | null; categoryId?: string | null }) {
  if (!isDay(o.day)) throw new MoneyError("Dates must be YYYY-MM-DD");
  if (o.day > todayIst()) throw new MoneyError("Pick today or an earlier day");
  const places = await ctx.tx.stockLocation.findMany({ orderBy: [{ kind: "asc" }, { name: "asc" }], select: { id: true, name: true, kind: true, active: true } });
  const placeOf = new Map(places.map((p) => [p.id, p]));
  const product: Prisma.ProductWhereInput = {};
  if (o.supplierId) product.supplierId = o.supplierId;
  if (o.categoryId) product.categoryId = o.categoryId;
  const lots = await lotsOn(ctx, o.day, { ...(o.locationId ? { locationId: o.locationId } : {}), product });
  const held = lots.filter((l) => l.qtyOn > 0);
  const products = await ctx.tx.product.findMany({
    where: { id: { in: [...new Set(held.map((l) => l.productId))] } },
    select: { id: true, name: true, sku: true, unit: true, lastCost: true, supplier: { select: { id: true, name: true } }, category: { select: { id: true, name: true } } },
  });
  const pOf = new Map(products.map((p) => [p.id, p]));

  const rows = new Map<string, ValuationRow>();
  const groups = new Map<string, { key: string; name: string; qty: number; value: number; products: Set<string> }>();
  const out = { total: 0, units: 0, warehouse: 0, van: 0, damaged: 0, damagedUnits: 0, atLastCost: 0, noCost: 0 };
  for (const l of held) {
    const p = pOf.get(l.productId);
    const loc = placeOf.get(l.locationId);
    if (!p || !loc) continue;
    const cost = l.unitCost ?? p.lastCost;
    const v = l.qtyOn * (cost ?? 0);
    if (loc.kind === "DAMAGED") {
      out.damaged += v;
      out.damagedUnits += l.qtyOn;
      continue;
    }
    out.total += v;
    out.units += l.qtyOn;
    if (loc.kind === "VAN") out.van += v;
    else out.warehouse += v;
    const r = rows.get(p.id) ?? {
      productId: p.id,
      name: p.name,
      sku: p.sku,
      unit: p.unit,
      company: p.supplier?.name ?? "No company",
      category: p.category.name,
      qty: 0,
      value: 0,
      atLastCost: 0,
      noCost: 0,
    };
    r.qty += l.qtyOn;
    r.value += v;
    if (l.unitCost === null && p.lastCost !== null) r.atLastCost += l.qtyOn;
    if (cost === null) r.noCost += l.qtyOn;
    rows.set(p.id, r);
    const [key, name] =
      o.by === "company" ? [p.supplier?.id ?? "", p.supplier?.name ?? "No company"] : o.by === "category" ? [p.category.id, p.category.name] : o.by === "place" ? [loc.id, loc.name] : [p.id, p.name];
    const g = groups.get(key) ?? { key, name, qty: 0, value: 0, products: new Set<string>() };
    g.qty += l.qtyOn;
    g.value += v;
    g.products.add(p.id);
    groups.set(key, g);
  }
  const list = [...rows.values()].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  for (const r of list) {
    if (r.atLastCost) out.atLastCost++;
    if (r.noCost) out.noCost++;
  }
  const [company, category] = await Promise.all([
    o.supplierId ? ctx.tx.supplier.findUnique({ where: { id: o.supplierId }, select: { name: true } }) : null,
    o.categoryId ? ctx.tx.category.findUnique({ where: { id: o.categoryId }, select: { name: true } }) : null,
  ]);
  return {
    day: o.day,
    by: o.by,
    filters: { place: o.locationId ? (placeOf.get(o.locationId)?.name ?? null) : null, company: company?.name ?? null, category: category?.name ?? null },
    ...out,
    groups: [...groups.values()].map((g) => ({ key: g.key, name: g.name, qty: g.qty, value: g.value, products: g.products.size })).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name)),
    rows: list,
  };
}

/** Choices for the valuation and count forms. */
export async function stockChoices(ctx: Ctx) {
  const [tracking, places, companies, categories] = await Promise.all([
    stockOn(ctx),
    ctx.tx.stockLocation.findMany({ where: { active: true }, orderBy: [{ kind: "asc" }, { name: "asc" }], select: { id: true, name: true, kind: true, isDefault: true } }),
    ctx.tx.supplier.findMany({ where: { kind: "GOODS" }, orderBy: { name: "asc" }, select: { id: true, name: true, active: true } }),
    ctx.tx.category.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, active: true } }),
  ]);
  return { tracking: !!tracking, places, companies, categories };
}

// ───────────────────────────── closing stock (A6.5) ─────────────────────────────

/**
 * Closing stock for the P&L and balance sheet as at the end of a day.
 * Tracking on: the app's stock at cost (counts have already corrected it).
 * Tracking off: the latest accepted count on or before the day.
 */
export async function closingStock(ctx: Ctx, day: string) {
  const tracking = await stockOn(ctx);
  const lastOf = (modes: StockCountMode[]) =>
    ctx.tx.stockCount.findFirst({
      where: { mode: { in: modes }, status: "ACCEPTED", date: { lte: dbDay(day) } },
      orderBy: [{ date: "desc" }, { acceptedAt: "desc" }],
      select: { id: true, number: true, date: true, countedValue: true, location: { select: { name: true } } },
    });
  if (tracking) {
    const v = await stockValuation(ctx, { day, by: "company" });
    const last = await lastOf(["TRACKED"]);
    return {
      day,
      value: v.total,
      source: "book" as const,
      lastCount: last ? { id: last.id, number: last.number, date: dayText(last.date), place: last.location?.name ?? null } : null,
      note: last
        ? dayText(last.date) === day
          ? `Counted on ${showDay(day)} (${last.number}${last.location ? `, ${last.location.name}` : ""}).`
          : `The app's stock at cost. Last counted on ${showDay(dayText(last.date))} (${last.number}${last.location ? `, ${last.location.name}` : ""}).`
        : null,
      warning: last ? null : `Not counted: no physical count was accepted on or before ${showDay(day)}, so this is the app's stock at cost.`,
      noCost: v.noCost,
      byCompany: v.groups,
    };
  }
  const last = await lastOf(["QUANTITY", "VALUE"]);
  if (!last) {
    return {
      day,
      value: 0,
      source: "none" as const,
      lastCount: null,
      note: null,
      warning: `Stock tracking is off and no stock count was accepted on or before ${showDay(day)}, so closing stock is taken as ₹0.`,
      noCost: 0,
      byCompany: [],
    };
  }
  const d = dayText(last.date);
  return {
    day,
    value: n(last.countedValue),
    source: "count" as const,
    lastCount: { id: last.id, number: last.number, date: d, place: null },
    note: d === day ? `Counted on ${showDay(day)} (${last.number}).` : null,
    warning: d === day ? null : `The last count is from ${showDay(d)} (${last.number}); stock bought and sold since is not in it.`,
    noCost: 0,
    byCompany: [],
  };
}

// ───────────────────────────── counts (A6.2–A6.4) ─────────────────────────────

export type StartCountInput = { date: string; mode?: "QUANTITY" | "VALUE" | null; locationId?: string | null; supplierId?: string | null; categoryId?: string | null; note?: string | null };

async function countOr404(ctx: Ctx, id: string) {
  const c = await ctx.tx.stockCount.findUnique({ where: { id } });
  if (!c) throw new MoneyError("Stock count not found", 404);
  return c;
}
async function draft(ctx: Ctx, id: string) {
  const c = await countOr404(ctx, id);
  if (c.status !== "DRAFT") throw new MoneyError(`${c.number} is ${COUNT_STATUS_LABEL[c.status].toLowerCase()}; it can't be changed`, 409);
  return c;
}
const lockCount = (ctx: Ctx, id: string) => ctx.tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`stockcount:${id}`}))`;

/** Start a count sheet. Tracking on: one place, the batches in stock there that day. Off: every product, or every company. */
export async function startCount(ctx: Ctx, input: StartCountInput) {
  const date = input.date;
  if (!isDay(date)) throw new MoneyError("Enter the day counted");
  if (date > todayIst()) throw new MoneyError("The day counted is in the future");
  await assertBooksOpen(ctx, dayStart(date));
  const tracking = await stockOn(ctx);
  const note = clean(input.note, 200) || null;
  let mode: StockCountMode;
  let locationId: string | null = null;
  let supplierId: string | null = null;
  let categoryId: string | null = null;
  const lines: Omit<Prisma.StockCountLineCreateManyInput, "countId" | "tenantId">[] = [];

  if (tracking) {
    mode = "TRACKED";
    const loc = input.locationId ? await ctx.tx.stockLocation.findUnique({ where: { id: input.locationId } }) : null;
    if (!loc || !loc.active) throw new MoneyError("Pick the place counted");
    if (loc.kind === "DAMAGED") throw new MoneyError("The damaged bin isn't counted: its goods are written off or sent back");
    locationId = loc.id;
    if (input.supplierId) {
      const s = await ctx.tx.supplier.findUnique({ where: { id: input.supplierId }, select: { id: true, kind: true } });
      if (!s || s.kind !== "GOODS") throw new MoneyError("Company not found", 404);
      supplierId = s.id;
    }
    if (input.categoryId) {
      const c = await ctx.tx.category.findUnique({ where: { id: input.categoryId }, select: { id: true } });
      if (!c) throw new MoneyError("Category not found", 404);
      categoryId = c.id;
    }
    const lots = (await lotsOn(ctx, date, { locationId, product: { ...(supplierId ? { supplierId } : {}), ...(categoryId ? { categoryId } : {}) } })).filter((l) => l.qtyOn > 0);
    const names = new Map((await ctx.tx.product.findMany({ where: { id: { in: [...new Set(lots.map((l) => l.productId))] } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
    lots.sort(
      (a, b) => (names.get(a.productId) ?? "").localeCompare(names.get(b.productId) ?? "") || (a.expiry?.getTime() ?? Infinity) - (b.expiry?.getTime() ?? Infinity) || a.batch.localeCompare(b.batch),
    );
    for (const l of lots) lines.push({ sl: 0, productId: l.productId, lotId: l.id, batch: l.batch, expiry: l.expiry, bookQty: l.qtyOn });
  } else if (input.mode === "VALUE") {
    mode = "VALUE";
    const companies = await ctx.tx.supplier.findMany({ where: { kind: "GOODS", active: true }, orderBy: { name: "asc" }, select: { id: true } });
    for (const s of companies) lines.push({ sl: 0, supplierId: s.id });
    lines.push({ sl: 0, supplierId: null, note: "Other goods" });
  } else {
    mode = "QUANTITY";
    const products = await ctx.tx.product.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true } });
    for (const p of products) lines.push({ sl: 0, productId: p.id });
  }
  if (lines.length > MAX_LINES) throw new MoneyError(`That makes ${lines.length.toLocaleString("en-IN")} lines; pick one company or category at a time`);

  const fy = fyCode(dayStart(date));
  const number = docNumber("SC", fy, await nextSequence(ctx.tx, ctx.tenantId, `sc:${fy}`));
  const count = await ctx.tx.stockCount.create({
    data: { tenantId: ctx.tenantId, number, date: dbDay(date), mode, locationId, supplierId, categoryId, note, createdById: ctx.actorId },
  });
  if (lines.length) await ctx.tx.stockCountLine.createMany({ data: lines.map((l, i) => ({ ...l, sl: i + 1, tenantId: ctx.tenantId, countId: count.id })) });
  return count;
}

export type CountLineSave = { id: string; countedQty?: number | null; rate?: number | null; value?: number | null; note?: string | null };

/** Save what was counted (from the phone, a few lines at a time). null clears a line. */
export async function saveCountLines(ctx: Ctx, id: string, rows: CountLineSave[]) {
  await lockCount(ctx, id);
  const c = await draft(ctx, id);
  if (!Array.isArray(rows) || !rows.length) throw new MoneyError("Nothing to save");
  if (rows.length > SAVE_ROWS) throw new MoneyError(`Save at most ${SAVE_ROWS} lines at a time`);
  let saved = 0;
  for (const r of rows) {
    const data: Prisma.StockCountLineUpdateManyMutationInput = {};
    if (c.mode === "VALUE") {
      if (r.value !== undefined) data.value = r.value === null ? null : BigInt(paise(r.value, "The value", MAX_VALUE));
    } else {
      if (r.countedQty !== undefined) data.countedQty = r.countedQty === null ? null : wholeQty(r.countedQty, "The count");
      if (r.rate !== undefined) data.rate = r.rate === null ? null : paise(r.rate, "The rate", MAX_RATE);
    }
    if (r.note !== undefined) data.note = clean(r.note, 120) || null;
    if (!Object.keys(data).length) continue;
    const u = await ctx.tx.stockCountLine.updateMany({ where: { id: String(r.id), countId: c.id }, data });
    if (u.count !== 1) throw new MoneyError("A line was not found on this count", 404);
    saved++;
  }
  return { saved };
}

/** A product (or another batch of it) found while counting that is not on the sheet. */
export async function addCountLine(ctx: Ctx, id: string, a: { productId: string; batch?: string | null; expiry?: string | null; countedQty?: number | null; rate?: number | null }) {
  await lockCount(ctx, id);
  const c = await draft(ctx, id);
  if (c.mode === "VALUE") throw new MoneyError("This count is by company value; there are no product lines");
  const p = a.productId ? await ctx.tx.product.findUnique({ where: { id: a.productId }, select: { id: true, name: true, supplierId: true, categoryId: true } }) : null;
  if (!p) throw new MoneyError("Product not found", 404);
  if (c.supplierId && p.supplierId !== c.supplierId) throw new MoneyError(`${p.name} is not one of this count's company's products`);
  if (c.categoryId && p.categoryId !== c.categoryId) throw new MoneyError(`${p.name} is not in this count's category`);
  const counted = a.countedQty === undefined || a.countedQty === null ? null : wholeQty(a.countedQty, "The count");
  const rate = a.rate === undefined || a.rate === null ? null : paise(a.rate, "The rate", MAX_RATE);
  const last = await ctx.tx.stockCountLine.aggregate({ where: { countId: c.id }, _max: { sl: true }, _count: true });
  if (last._count >= MAX_LINES) throw new MoneyError("This count has the most lines it can take");
  const sl = (last._max.sl ?? 0) + 1;
  if (c.mode === "QUANTITY") {
    const dup = await ctx.tx.stockCountLine.findFirst({ where: { countId: c.id, productId: p.id }, select: { sl: true } });
    if (dup) throw new MoneyError(`${p.name} is already on the sheet (line ${dup.sl})`, 409);
    return ctx.tx.stockCountLine.create({ data: { tenantId: ctx.tenantId, countId: c.id, sl, productId: p.id, countedQty: counted, rate, added: true } });
  }
  const batch = clean(a.batch, 40);
  if (a.expiry && !isDay(a.expiry)) throw new MoneyError("Expiry must be a date");
  const expiry = a.expiry ? dbDay(a.expiry) : null;
  const lot = await ctx.tx.stockLot.findFirst({ where: { locationId: c.locationId!, productId: p.id, batch, expiry } });
  const dup = await ctx.tx.stockCountLine.findFirst({
    where: { countId: c.id, productId: p.id, ...(lot ? { lotId: lot.id } : { lotId: null, batch, expiry }) },
    select: { sl: true },
  });
  if (dup) throw new MoneyError(`${p.name}${batch ? ` batch ${batch}` : ""} is already on the sheet (line ${dup.sl})`, 409);
  const book = lot ? ((await lotsOn(ctx, dayText(c.date), { id: lot.id }))[0]?.qtyOn ?? 0) : 0;
  return ctx.tx.stockCountLine.create({
    data: { tenantId: ctx.tenantId, countId: c.id, sl, productId: p.id, lotId: lot?.id ?? null, batch, expiry, bookQty: book, countedQty: counted, rate, added: true },
  });
}

/** Take off a line added by hand. */
export async function removeCountLine(ctx: Ctx, id: string, lineId: string) {
  await lockCount(ctx, id);
  const c = await draft(ctx, id);
  const l = await ctx.tx.stockCountLine.findFirst({ where: { id: lineId, countId: c.id } });
  if (!l) throw new MoneyError("Line not found", 404);
  if (!l.added) throw new MoneyError("Only lines added while counting can be taken off; count this one as 0 if there is none");
  await ctx.tx.stockCountLine.delete({ where: { id: l.id } });
  return { removed: 1 };
}

/** Fill the lines not counted yet: with the app's quantity (tracked counts), or with 0. */
export async function fillBlankLines(ctx: Ctx, id: string, how: "book" | "zero") {
  await lockCount(ctx, id);
  const c = await draft(ctx, id);
  if (c.mode === "VALUE") {
    const u = await ctx.tx.stockCountLine.updateMany({ where: { countId: c.id, value: null }, data: { value: BigInt(0) } });
    return { filled: u.count };
  }
  if (how === "zero" || c.mode === "QUANTITY") {
    const u = await ctx.tx.stockCountLine.updateMany({ where: { countId: c.id, countedQty: null }, data: { countedQty: 0 } });
    return { filled: u.count };
  }
  const blank = await ctx.tx.stockCountLine.findMany({ where: { countId: c.id, countedQty: null }, select: { id: true, lotId: true } });
  const lotIds = blank.map((l) => l.lotId).filter((x): x is string => !!x);
  const on = new Map((await lotsOn(ctx, dayText(c.date), { id: { in: lotIds } })).map((l) => [l.id, l.qtyOn]));
  for (const l of blank) await ctx.tx.stockCountLine.update({ where: { id: l.id }, data: { countedQty: l.lotId ? (on.get(l.lotId) ?? 0) : 0 } });
  return { filled: blank.length };
}

type LineCalc = {
  id: string;
  sl: number;
  productId: string | null;
  name: string;
  sku: string | null;
  unit: string | null;
  company: string | null;
  supplierId: string | null;
  lotId: string | null;
  batch: string;
  expiry: string | null;
  added: boolean;
  note: string | null;
  bookQty: number;
  countedQty: number | null;
  /** The rate used, and where it came from. */
  rate: number | null;
  rateFrom: "entered" | "batch" | "last" | null;
  enteredRate: number | null;
  /** The rate used when none is entered (batch cost, else last cost). */
  autoRate: number | null;
  autoFrom: "batch" | "last" | null;
  value: number | null;
  diffQty: number | null;
  bookValue: number;
  countedValue: number | null;
  diffValue: number | null;
};

/** A count with its lines, the app's quantities (live while counting) and the values at cost. */
export async function countDetail(ctx: Ctx, id: string) {
  const c = await ctx.tx.stockCount.findUnique({
    where: { id },
    include: {
      location: { select: { name: true, kind: true } },
      supplier: { select: { name: true } },
      category: { select: { name: true } },
      lines: {
        orderBy: { sl: "asc" },
        include: {
          product: { select: { name: true, sku: true, unit: true, lastCost: true, supplier: { select: { name: true } } } },
          supplier: { select: { name: true } },
        },
      },
    },
  });
  if (!c) throw new MoneyError("Stock count not found", 404);
  const draftTracked = c.status === "DRAFT" && c.mode === "TRACKED";
  const lotIds = c.lines.map((l) => l.lotId).filter((x): x is string => !!x);
  const lots = lotIds.length ? await lotsOn(ctx, dayText(c.date), { id: { in: lotIds } }) : [];
  const lotOf = new Map(lots.map((l) => [l.id, l]));
  const users = await ctx.tx.user.findMany({ where: { id: { in: [c.createdById, c.acceptedById].filter((x): x is string => !!x) } }, select: { id: true, name: true } });
  const who = (uid: string | null) => users.find((u) => u.id === uid)?.name ?? null;

  const lines: LineCalc[] = c.lines.map((l) => {
    const lot = l.lotId ? lotOf.get(l.lotId) : undefined;
    const book = c.mode !== "TRACKED" ? 0 : draftTracked ? (l.lotId ? (lot?.qtyOn ?? 0) : 0) : l.bookQty;
    const [rate, rateFrom] =
      l.rate !== null
        ? [l.rate, c.status === "ACCEPTED" ? null : ("entered" as const)]
        : c.status === "ACCEPTED"
          ? [null, null]
          : lot?.unitCost != null
            ? [lot.unitCost, "batch" as const]
            : l.product?.lastCost != null
              ? [l.product.lastCost, "last" as const]
              : [null, null];
    const counted = l.countedQty;
    return {
      id: l.id,
      sl: l.sl,
      productId: l.productId,
      name: l.product?.name ?? l.supplier?.name ?? l.note ?? "Other goods",
      sku: l.product?.sku ?? null,
      unit: l.product?.unit ?? null,
      company: l.product?.supplier?.name ?? l.supplier?.name ?? null,
      supplierId: l.supplierId,
      lotId: l.lotId,
      batch: l.batch,
      expiry: l.expiry ? dayText(l.expiry) : null,
      added: l.added,
      note: l.supplierId || c.mode !== "VALUE" ? l.note : null,
      bookQty: book,
      countedQty: counted,
      rate,
      rateFrom,
      enteredRate: c.status === "ACCEPTED" ? null : l.rate,
      autoRate: c.status === "ACCEPTED" ? null : (lot?.unitCost ?? l.product?.lastCost ?? null),
      autoFrom: c.status === "ACCEPTED" ? null : lot?.unitCost != null ? "batch" : l.product?.lastCost != null ? "last" : null,
      value: l.value === null ? null : n(l.value),
      diffQty: c.mode === "TRACKED" && counted !== null ? counted - book : null,
      bookValue: book * (rate ?? 0),
      countedValue: c.mode === "VALUE" ? (l.value === null ? null : n(l.value)) : counted === null ? null : counted * (rate ?? 0),
      diffValue: c.mode === "TRACKED" && counted !== null ? (counted - book) * (rate ?? 0) : null,
    };
  });
  const sum = (f: (l: LineCalc) => number | null) => lines.reduce((a, l) => a + (f(l) ?? 0), 0);
  const accepted = c.status === "ACCEPTED";
  const totals = {
    lines: lines.length,
    counted: lines.filter((l) => (c.mode === "VALUE" ? l.value !== null : l.countedQty !== null)).length,
    bookValue: accepted ? n(c.bookValue) : sum((l) => l.bookValue),
    countedValue: accepted ? n(c.countedValue) : sum((l) => l.countedValue),
    shortage: accepted ? n(c.shortage) : sum((l) => (l.diffValue !== null && l.diffValue < 0 ? -l.diffValue : 0)),
    excess: accepted ? n(c.excess) : sum((l) => (l.diffValue !== null && l.diffValue > 0 ? l.diffValue : 0)),
    short: lines.filter((l) => (l.diffQty ?? 0) < 0).length,
    over: lines.filter((l) => (l.diffQty ?? 0) > 0).length,
    noRate: lines.filter((l) => c.mode !== "VALUE" && l.rate === null && (l.countedQty ?? l.bookQty) > 0).length,
  };
  return {
    id: c.id,
    number: c.number,
    date: dayText(c.date),
    mode: c.mode,
    modeLabel: COUNT_MODE_LABEL[c.mode],
    status: c.status,
    statusLabel: COUNT_STATUS_LABEL[c.status],
    place: c.location?.name ?? null,
    company: c.supplier?.name ?? null,
    category: c.category?.name ?? null,
    note: c.note,
    entryId: c.entryId,
    createdBy: who(c.createdById),
    createdAt: c.createdAt.toISOString(),
    acceptedBy: who(c.acceptedById),
    acceptedAt: c.acceptedAt?.toISOString() ?? null,
    cancelledAt: c.cancelledAt?.toISOString() ?? null,
    cancelReason: c.cancelReason,
    lines,
    totals,
  };
}

/** Products that may be added to a count while counting (its company and category only). */
export async function countProductChoices(ctx: Ctx, id: string) {
  const c = await ctx.tx.stockCount.findUnique({ where: { id }, select: { mode: true, status: true, supplierId: true, categoryId: true } });
  if (!c || c.status !== "DRAFT" || c.mode === "VALUE") return [];
  return ctx.tx.product.findMany({
    where: { active: true, ...(c.supplierId ? { supplierId: c.supplierId } : {}), ...(c.categoryId ? { categoryId: c.categoryId } : {}) },
    orderBy: { name: "asc" },
    take: MAX_LINES,
    select: { id: true, name: true, sku: true, unit: true },
  });
}

/**
 * Accept a count: it becomes the closing stock for its day. Tracked: the
 * app's stock is corrected to what was counted (as at the end of that day)
 * and the net shortage at cost goes to stock shortage.
 */
export async function acceptCount(ctx: Ctx, id: string) {
  await lockCount(ctx, id);
  const c = await draft(ctx, id);
  const day = dayText(c.date);
  await assertBooksOpen(ctx, dayStart(day));
  const lines = await ctx.tx.stockCountLine.findMany({
    where: { countId: c.id },
    orderBy: { sl: "asc" },
    include: { product: { select: { name: true, lastCost: true } }, supplier: { select: { name: true } } },
  });
  const blank = lines.filter((l) => (c.mode === "VALUE" ? l.value === null : l.countedQty === null)).length;
  if (blank) throw new MoneyError(`${blank} ${blank === 1 ? "line is" : "lines are"} not counted yet. Count them, or fill the rest first.`);

  let bookValue = 0;
  let countedValue = 0;
  let shortage = 0;
  let excess = 0;
  let entryId: string | null = null;

  if (c.mode === "VALUE") {
    countedValue = lines.reduce((a, l) => a + n(l.value), 0);
  } else if (c.mode === "QUANTITY") {
    const missing = lines.filter((l) => (l.countedQty ?? 0) > 0 && l.rate === null && l.product?.lastCost == null).map((l) => l.product?.name ?? "?");
    if (missing.length) throw new MoneyError(`Enter the rate for ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? ` and ${missing.length - 3} more` : ""}`);
    for (const l of lines) {
      const rate = l.rate ?? l.product?.lastCost ?? 0;
      countedValue += (l.countedQty ?? 0) * rate;
      if (l.rate === null) await ctx.tx.stockCountLine.update({ where: { id: l.id }, data: { rate } });
    }
  } else {
    if (!(await stockOn(ctx))) throw new MoneyError("Stock tracking is off now, so this count can't correct the stock. Cancel it and start a new one.");
    const later = await ctx.tx.stockCount.findFirst({ where: { mode: "TRACKED", status: "ACCEPTED", locationId: c.locationId, date: { gt: c.date } }, select: { number: true, date: true } });
    if (later) throw new MoneyError(`${later.number}, a count of this place on ${showDay(dayText(later.date))}, is already accepted; a count from before it can't be accepted now`, 409);
    const at = day === todayIst() ? new Date() : dayEnd(day);
    const lotIds = lines.map((l) => l.lotId).filter((x): x is string => !!x);
    const lotOf = new Map((await lotsOn(ctx, day, { id: { in: lotIds } })).map((l) => [l.id, l]));
    const note = `Stock count ${c.number}`;
    for (const l of lines) {
      if (!l.productId) continue;
      const lot = l.lotId ? lotOf.get(l.lotId) : undefined;
      const book = lot?.qtyOn ?? 0;
      const rate = l.rate ?? lot?.unitCost ?? l.product?.lastCost ?? null;
      const counted = l.countedQty ?? 0;
      const delta = counted - book;
      bookValue += book * (rate ?? 0);
      countedValue += counted * (rate ?? 0);
      if (delta > 0) {
        excess += delta * (rate ?? 0);
        const spec = lot ? { batch: lot.batch, expiry: lot.expiry, mfgDate: lot.mfgDate, unitCost: lot.unitCost ?? rate } : { batch: l.batch, expiry: l.expiry, unitCost: rate };
        await stockIn(ctx, { kind: "ADJUST", locationId: c.locationId!, productId: l.productId, qty: delta, lot: spec, reason: "count", note, docId: c.id, at });
      } else if (delta < 0) {
        shortage += -delta * (rate ?? 0);
        await stockOut(ctx, {
          kind: "ADJUST",
          sources: [c.locationId!],
          productId: l.productId,
          qty: -delta,
          lotId: l.lotId,
          allowExpired: true,
          onShort: "refuse",
          reason: "count",
          note,
          docId: c.id,
          at,
        });
      }
      await ctx.tx.stockCountLine.update({ where: { id: l.id }, data: { bookQty: book, rate } });
    }
    const net = shortage - excess;
    if (Math.abs(net) > 2_000_000_000) throw new MoneyError("The difference is too large to post in one entry; count one company at a time");
    if (net !== 0) {
      const place = await ctx.tx.stockLocation.findUnique({ where: { id: c.locationId! }, select: { name: true } });
      const e = await post(ctx, {
        kind: "STOCK_COUNT",
        memo: `Stock count ${c.number} at ${place?.name ?? "the warehouse"}: shortage ${formatINR(shortage)}, excess ${formatINR(excess)}`,
        occurredAt: at,
        lines:
          net > 0
            ? [
                { account: { type: "STOCK_LOSS" }, amount: net },
                { account: { type: "PURCHASES" }, amount: -net },
              ]
            : [
                { account: { type: "PURCHASES" }, amount: -net },
                { account: { type: "STOCK_LOSS" }, amount: net },
              ],
      });
      entryId = e.id;
    }
  }

  return ctx.tx.stockCount.update({
    where: { id: c.id },
    data: {
      status: "ACCEPTED",
      bookValue: BigInt(bookValue),
      countedValue: BigInt(countedValue),
      shortage: BigInt(shortage),
      excess: BigInt(excess),
      entryId,
      acceptedById: ctx.actorId,
      acceptedAt: new Date(),
    },
  });
}

/** Cancel a count still being counted, or an accepted value count (tracking off). An accepted tracked count is corrected by counting again. */
export async function cancelCount(ctx: Ctx, id: string, reason: string) {
  await lockCount(ctx, id);
  const c = await countOr404(ctx, id);
  const why = clean(reason, 200);
  if (why.length < 3) throw new MoneyError("Write why it is cancelled");
  if (c.status === "CANCELLED") throw new MoneyError(`${c.number} is already cancelled`, 409);
  if (c.status === "ACCEPTED" && c.mode === "TRACKED") throw new MoneyError("An accepted count has already corrected the stock; count again to correct it", 409);
  return ctx.tx.stockCount.update({ where: { id: c.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: why } });
}

/** Counts, newest first, with how far each has got. */
export async function countList(ctx: Ctx) {
  const counts = await ctx.tx.stockCount.findMany({
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 300,
    include: { location: { select: { name: true } }, supplier: { select: { name: true } }, category: { select: { name: true } } },
  });
  const ids = counts.map((c) => c.id);
  const [all, qty, val] = await Promise.all([
    ctx.tx.stockCountLine.groupBy({ by: ["countId"], where: { countId: { in: ids } }, _count: true }),
    ctx.tx.stockCountLine.groupBy({ by: ["countId"], where: { countId: { in: ids }, countedQty: { not: null } }, _count: true }),
    ctx.tx.stockCountLine.groupBy({ by: ["countId"], where: { countId: { in: ids }, value: { not: null } }, _count: true }),
  ]);
  const m = (rows: { countId: string; _count: number }[]) => new Map(rows.map((r) => [r.countId, r._count]));
  const [allOf, qtyOf, valOf] = [m(all), m(qty), m(val)];
  return counts.map((c) => ({
    id: c.id,
    number: c.number,
    date: dayText(c.date),
    mode: c.mode,
    status: c.status,
    statusLabel: COUNT_STATUS_LABEL[c.status],
    what: [c.location?.name, c.supplier?.name, c.category?.name].filter(Boolean).join(" · ") || COUNT_MODE_LABEL[c.mode],
    lines: allOf.get(c.id) ?? 0,
    counted: (c.mode === "VALUE" ? valOf : qtyOf).get(c.id) ?? 0,
    countedValue: n(c.countedValue),
    shortage: n(c.shortage),
    excess: n(c.excess),
  }));
}
