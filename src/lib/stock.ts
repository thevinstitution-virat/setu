import { MoneyError, type Ctx } from "@/lib/ledger";
import type { Tx } from "@/lib/db";
import type { StockMoveKind, StockPlace } from "@/generated/prisma/client";
import { docNumber, fyCode } from "@/lib/gst";
import { nextSequence } from "@/lib/orders";
import {
  inventorySettings,
  isAdjustReason,
  isDamageReason,
  isReturnCondition,
  type InventorySettings,
  type ReturnCondition,
} from "@/lib/inventory-settings";
import { addDays, isExpired, istToday, loadLine, pickFefo, reorderSuggestion } from "@/lib/stock-math";

/**
 * Inventory (Phase 5). Stock sits in lots (product + batch + expiry at a
 * place: warehouse, van or the damaged bin). Every change goes through the
 * functions here, which update the lot and write an append-only StockMove,
 * under a per-place-per-product lock.
 *
 * - Goods leave first expiry first (FEFO); expired lots are never loaded or sold.
 * - Order goods move warehouse → van when a trip is loaded or starts, and are
 *   sold out of the van at delivery (or out of the warehouse when there is no van).
 * - A delivery never fails on stock: when the records are short, the missing
 *   units are booked in first with an "records were short" adjustment, so the
 *   gap shows up in the history for review.
 * - Available to order = sellable stock in warehouses and vans − quantities
 *   on open orders (placed, confirmed, packed, out for delivery).
 */

export type LotSpec = { batch?: string | null; expiry?: Date | null; mfgDate?: Date | null; unitCost?: number | null };
export type StockRefs = {
  orderId?: string | null;
  orderItemId?: string | null;
  tripId?: string | null;
  purchaseId?: string | null;
  docId?: string | null;
  reason?: string | null;
  note?: string | null;
};
type Pick = { lotId: string; qty: number; batch: string; expiry: Date | null; mfgDate: Date | null; unitCost: number | null };

const OPEN_ORDER = ["PLACED", "CONFIRMED", "PACKED", "OUT_FOR_DELIVERY"] as const;
const MAX_QTY = 1_000_000;

const assertQty = (q: number, what = "Quantity") => {
  if (!Number.isInteger(q) || q < 1 || q > MAX_QTY) throw new MoneyError(`${what} must be a whole number above 0`);
};

export async function stockSettings(tx: Tx, tenantId: string): Promise<InventorySettings> {
  const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { settings: true } });
  return inventorySettings(t.settings);
}

/** Stock settings when tracking is on, else null. */
export async function stockOn(ctx: Ctx) {
  const s = await stockSettings(ctx.tx, ctx.tenantId);
  return s.enabled ? s : null;
}

async function requireStock(ctx: Ctx) {
  const s = await stockOn(ctx);
  if (!s) throw new MoneyError("Stock tracking is off. Turn it on in Settings → Stock.");
  return s;
}

// ───────────────────────────── places ─────────────────────────────

/** The warehouse vans load from (made on first use). */
export async function defaultWarehouse(ctx: Ctx) {
  const d = await ctx.tx.stockLocation.findFirst({ where: { kind: "WAREHOUSE", isDefault: true } });
  if (d) return d;
  const any = await ctx.tx.stockLocation.findFirst({ where: { kind: "WAREHOUSE", active: true }, orderBy: { createdAt: "asc" } });
  if (any) return ctx.tx.stockLocation.update({ where: { id: any.id }, data: { isDefault: true } });
  return ctx.tx.stockLocation.create({ data: { kind: "WAREHOUSE", name: "Main warehouse", isDefault: true } });
}

/** The damaged and expired bin (made on first use). */
export async function damagedBin(ctx: Ctx) {
  const d = await ctx.tx.stockLocation.findFirst({ where: { kind: "DAMAGED" }, orderBy: { createdAt: "asc" } });
  return d ?? ctx.tx.stockLocation.create({ data: { kind: "DAMAGED", name: "Damaged & expired" } });
}

/** A vehicle's van stock place (made on first use). */
export async function vanLocation(ctx: Ctx, vehicleId: string) {
  const v = await ctx.tx.stockLocation.findUnique({ where: { vehicleId } });
  if (v) return v;
  const vehicle = await ctx.tx.vehicle.findUnique({ where: { id: vehicleId } });
  if (!vehicle) throw new MoneyError("Vehicle not found", 404);
  return ctx.tx.stockLocation.create({ data: { kind: "VAN", name: `Van ${vehicle.number}`, vehicleId } });
}

async function place(ctx: Ctx, id: string, kinds?: StockPlace[]) {
  const loc = await ctx.tx.stockLocation.findUnique({ where: { id } });
  if (!loc || !loc.active) throw new MoneyError("Stock place not found", 404);
  if (kinds && !kinds.includes(loc.kind)) throw new MoneyError(`That can't be done at ${loc.name}`);
  return loc;
}

// ───────────────────────────── lots and moves ─────────────────────────────

/** Serialise stock changes per place and product (sorted, so two-place moves can't deadlock). */
async function lock(ctx: Ctx, pairs: [string, string][]) {
  const keys = [...new Set(pairs.map(([loc, prod]) => `stock:${loc}:${prod}`))].sort();
  for (const k of keys) await ctx.tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${k}))`;
}

async function putIntoLot(ctx: Ctx, locationId: string, productId: string, spec: LotSpec, qty: number) {
  const batch = (spec.batch ?? "").trim().slice(0, 40);
  const expiry = spec.expiry ?? null;
  const lot = await ctx.tx.stockLot.findFirst({ where: { locationId, productId, batch, expiry } });
  if (lot) {
    return ctx.tx.stockLot.update({
      where: { id: lot.id },
      data: { qty: { increment: qty }, unitCost: lot.unitCost ?? spec.unitCost ?? null, mfgDate: lot.mfgDate ?? spec.mfgDate ?? null },
    });
  }
  return ctx.tx.stockLot.create({
    data: { locationId, productId, batch, expiry, mfgDate: spec.mfgDate ?? null, unitCost: spec.unitCost ?? null, qty },
  });
}

async function productInfo(ctx: Ctx, productId: string) {
  const p = await ctx.tx.product.findUnique({ where: { id: productId }, select: { id: true, name: true, unit: true, lastCost: true, caseSize: true } });
  if (!p) throw new MoneyError("Product not found", 404);
  return p;
}

const refData = (r: StockRefs) => ({
  orderId: r.orderId ?? null,
  orderItemId: r.orderItemId ?? null,
  tripId: r.tripId ?? null,
  purchaseId: r.purchaseId ?? null,
  docId: r.docId ?? null,
  reason: r.reason ?? null,
  note: r.note?.trim().slice(0, 300) || null,
});

/** Stock in at one place (purchase, opening, return, adjustment). The caller need not lock. */
export async function stockIn(
  ctx: Ctx,
  p: { kind: StockMoveKind; locationId: string; productId: string; qty: number; lot?: LotSpec } & StockRefs
) {
  assertQty(p.qty);
  await lock(ctx, [[p.locationId, p.productId]]);
  const lot = await putIntoLot(ctx, p.locationId, p.productId, p.lot ?? {}, p.qty);
  await ctx.tx.stockMove.create({
    data: { kind: p.kind, productId: p.productId, lotId: lot.id, toId: p.locationId, qty: p.qty, unitCost: lot.unitCost, actorId: ctx.actorId, ...refData(p) },
  });
  return lot;
}

/**
 * Take up to qty from a place, first expiry first (caller holds the lock).
 * Decrements the lots; returns what was taken and what couldn't be.
 */
async function takeUpTo(ctx: Ctx, locationId: string, productId: string, qty: number, opts: { lotId?: string | null; allowExpired?: boolean }) {
  const lots = await ctx.tx.stockLot.findMany({
    where: { locationId, productId, qty: { gt: 0 }, ...(opts.lotId ? { id: opts.lotId } : {}) },
  });
  const { picks, short } = pickFefo(lots, qty, { today: istToday(), allowExpired: opts.allowExpired || !!opts.lotId });
  const out: Pick[] = [];
  for (const { lot, qty: q } of picks) {
    const n = await ctx.tx.$executeRaw`UPDATE "StockLot" SET "qty" = "qty" - ${q}, "updatedAt" = now() WHERE "id" = ${lot.id} AND "qty" >= ${q}`;
    if (n !== 1) throw new MoneyError("Stock changed while saving. Try again.", 409);
    out.push({ lotId: lot.id, qty: q, batch: lot.batch, expiry: lot.expiry, mfgDate: lot.mfgDate, unitCost: lot.unitCost });
  }
  return { picks: out, short };
}

type OutOpts = {
  lotId?: string | null;
  allowExpired?: boolean;
  /** refuse: throw when short. correct: book the missing units in first (reason) and take them. */
  onShort: "refuse" | "correct";
  correctReason?: string;
};

/** Take qty from the first places in order; anything still missing is handled at the first place. */
async function take(ctx: Ctx, sources: string[], productId: string, qty: number, opts: OutOpts, refs: StockRefs) {
  const picks: (Pick & { from: string })[] = [];
  let left = qty;
  for (const src of sources) {
    if (left <= 0) break;
    const r = await takeUpTo(ctx, src, productId, left, opts);
    picks.push(...r.picks.map((x) => ({ ...x, from: src })));
    left = r.short;
  }
  if (left > 0) {
    const p = await productInfo(ctx, productId);
    if (opts.onShort === "refuse") {
      const have = qty - left;
      const loc = await ctx.tx.stockLocation.findUnique({ where: { id: sources[0] }, select: { name: true } });
      throw new MoneyError(`Only ${have} ${p.unit} of ${p.name} at ${loc?.name ?? "this place"}${opts.allowExpired ? "" : " (not counting expired)"}`, 409);
    }
    const at = sources[0];
    const lot = await putIntoLot(ctx, at, productId, { unitCost: p.lastCost }, left);
    await ctx.tx.stockMove.create({
      data: { kind: "ADJUST", productId, lotId: lot.id, toId: at, qty: left, unitCost: lot.unitCost, actorId: ctx.actorId, ...refData({ ...refs, reason: opts.correctReason ?? "sold_unrecorded", note: null }) },
    });
    const r = await takeUpTo(ctx, at, productId, left, { lotId: lot.id });
    picks.push(...r.picks.map((x) => ({ ...x, from: at })));
  }
  return picks;
}

/** Stock out of a place (sale, write-off, supplier return, adjustment). */
export async function stockOut(
  ctx: Ctx,
  p: { kind: StockMoveKind; sources: string[]; productId: string; qty: number } & OutOpts & StockRefs
) {
  assertQty(p.qty);
  await lock(ctx, p.sources.map((s) => [s, p.productId] as [string, string]));
  const picks = await take(ctx, p.sources, p.productId, p.qty, p, p);
  for (const x of picks) {
    await ctx.tx.stockMove.create({
      data: { kind: p.kind, productId: p.productId, lotId: x.lotId, fromId: x.from, qty: x.qty, unitCost: x.unitCost, actorId: ctx.actorId, ...refData(p) },
    });
  }
  return picks;
}

/** Move stock between two places, keeping batch and expiry (load, unload, transfer, to damaged). */
export async function stockTransfer(
  ctx: Ctx,
  p: { kind: StockMoveKind; fromId: string; toId: string; productId: string; qty: number } & OutOpts & StockRefs
) {
  assertQty(p.qty);
  if (p.fromId === p.toId) throw new MoneyError("Pick two different places");
  await lock(ctx, [[p.fromId, p.productId], [p.toId, p.productId]]);
  const picks = await take(ctx, [p.fromId], p.productId, p.qty, p, p);
  for (const x of picks) {
    const into = await putIntoLot(ctx, p.toId, p.productId, x, x.qty);
    await ctx.tx.stockMove.create({
      data: { kind: p.kind, productId: p.productId, lotId: x.lotId, toLotId: into.id, fromId: p.fromId, toId: p.toId, qty: x.qty, unitCost: x.unitCost, actorId: ctx.actorId, ...refData(p) },
    });
  }
  return picks;
}

// ───────────────────────────── levels ─────────────────────────────

export type ProductStock = {
  productId: string;
  warehouse: number;
  van: number;
  damaged: number;
  /** Past expiry, still in a warehouse or van. */
  expired: number;
  /** On open orders. */
  reserved: number;
  /** warehouse + van − reserved (can be below 0). */
  available: number;
  /** Cost value of the sellable and expired stock, paise (lots without a cost count 0). */
  value: number;
};

/** Stock per product (all products with stock or open orders, or just the ones asked for). */
export async function stockLevels(tx: Tx, productIds?: string[]) {
  const today = istToday();
  const only = productIds ? { productId: { in: productIds } } : {};
  const [lots, reserved] = await Promise.all([
    tx.stockLot.findMany({
      where: { qty: { gt: 0 }, ...only },
      select: { productId: true, qty: true, expiry: true, unitCost: true, location: { select: { kind: true } } },
    }),
    tx.orderItem.groupBy({
      by: ["productId"],
      where: { order: { status: { in: [...OPEN_ORDER] } }, ...only },
      _sum: { quantity: true },
    }),
  ]);
  const out = new Map<string, ProductStock>();
  const row = (id: string) => {
    let r = out.get(id);
    if (!r) out.set(id, (r = { productId: id, warehouse: 0, van: 0, damaged: 0, expired: 0, reserved: 0, available: 0, value: 0 }));
    return r;
  };
  for (const l of lots) {
    const r = row(l.productId);
    if (l.location.kind === "DAMAGED") r.damaged += l.qty;
    else {
      r.value += l.qty * (l.unitCost ?? 0);
      if (isExpired(l, today)) r.expired += l.qty;
      else if (l.location.kind === "VAN") r.van += l.qty;
      else r.warehouse += l.qty;
    }
  }
  for (const g of reserved) row(g.productId).reserved = g._sum.quantity ?? 0;
  for (const r of out.values()) r.available = r.warehouse + r.van - r.reserved;
  return out;
}

/** Sellable (not expired) stock per product at one place. */
async function sellableAt(tx: Tx, locationId: string, productIds?: string[]) {
  const today = istToday();
  const lots = await tx.stockLot.findMany({
    where: { locationId, qty: { gt: 0 }, ...(productIds ? { productId: { in: productIds } } : {}) },
    select: { productId: true, qty: true, expiry: true },
  });
  const m = new Map<string, number>();
  for (const l of lots) if (!isExpired(l, today)) m.set(l.productId, (m.get(l.productId) ?? 0) + l.qty);
  return m;
}

/**
 * Order-time check (quoteCart): products asked for beyond what is available.
 * Empty when tracking is off or the check is off.
 */
export async function orderStockShort(tx: Tx, tenantSettings: unknown, wanted: Map<string, number>) {
  const s = inventorySettings(tenantSettings);
  if (!s.enabled || s.orderCheck === "off" || wanted.size === 0) return { mode: "off" as const, short: [] as { productId: string; available: number; wanted: number }[] };
  const levels = await stockLevels(tx, [...wanted.keys()]);
  const short = [...wanted.entries()]
    .map(([productId, qty]) => ({ productId, wanted: qty, available: Math.max(0, levels.get(productId)?.available ?? 0) }))
    .filter((x) => x.wanted > x.available);
  return { mode: s.orderCheck, short };
}

/** Storefront badge per product: out of stock, or few left (at or under the reorder level, else 2 × MOQ). No numbers are shown to retailers. */
export async function stockBadges(tx: Tx, tenantSettings: unknown, productIds: string[]) {
  const s = inventorySettings(tenantSettings);
  const out = new Map<string, "out" | "low">();
  if (!s.enabled || s.orderCheck === "off" || !productIds.length) return out;
  const [levels, products] = await Promise.all([
    stockLevels(tx, productIds),
    tx.product.findMany({ where: { id: { in: productIds } }, select: { id: true, reorderLevel: true, moq: true } }),
  ]);
  for (const p of products) {
    const a = levels.get(p.id)?.available ?? 0;
    if (a <= 0) out.set(p.id, "out");
    else if (a <= (p.reorderLevel ?? p.moq * 2)) out.set(p.id, "low");
  }
  return out;
}

// ───────────────────────────── vans and trips ─────────────────────────────

/** What open stops on a van's trips still need, per product (optionally one trip only). */
async function vanNeeds(tx: Tx, vehicleId: string, tripId?: string) {
  const items = await tx.orderItem.findMany({
    where: {
      order: {
        status: { in: [...OPEN_ORDER] },
        delivery: { state: "ASSIGNED", trip: { vehicleId, status: { not: "CLOSED" }, ...(tripId ? { id: tripId } : {}) } },
      },
    },
    select: { productId: true, quantity: true },
  });
  const m = new Map<string, number>();
  for (const i of items) m.set(i.productId, (m.get(i.productId) ?? 0) + i.quantity);
  return m;
}

export type VanRow = {
  productId: string;
  name: string;
  unit: string;
  caseSize: number | null;
  onHand: number;
  expired: number;
  /** Needed by open stops on this van's trips. */
  reserved: number;
  /** What the driver may spot-sell. */
  free: number;
  lots: { batch: string; expiry: Date | null; qty: number }[];
};

/** Van stock: on hand, held for open stops, free to spot-sell. */
export async function vanStock(ctx: Ctx, vehicleId: string) {
  const loc = await vanLocation(ctx, vehicleId);
  const today = istToday();
  const [lots, needs] = await Promise.all([
    ctx.tx.stockLot.findMany({
      where: { locationId: loc.id, qty: { gt: 0 } },
      include: { product: { select: { name: true, unit: true, caseSize: true } } },
    }),
    vanNeeds(ctx.tx, vehicleId),
  ]);
  const rows = new Map<string, VanRow>();
  for (const l of lots) {
    const r = rows.get(l.productId) ?? { productId: l.productId, name: l.product.name, unit: l.product.unit, caseSize: l.product.caseSize, onHand: 0, expired: 0, reserved: 0, free: 0, lots: [] };
    r.onHand += l.qty;
    if (isExpired(l, today)) r.expired += l.qty;
    r.lots.push({ batch: l.batch, expiry: l.expiry, qty: l.qty });
    rows.set(l.productId, r);
  }
  for (const [productId, need] of needs) {
    const r = rows.get(productId);
    if (r) r.reserved = need;
  }
  for (const r of rows.values()) r.free = Math.max(0, r.onHand - r.expired - r.reserved);
  return { location: loc, rows: [...rows.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}

export type LoadRow = {
  productId: string;
  name: string;
  unit: string;
  caseSize: number | null;
  /** This trip's open stops. */
  need: number;
  /** Other open trips on the same van. */
  otherNeed: number;
  inVan: number;
  buffer: number;
  /** Must load to cover the orders. */
  forOrders: number;
  /** Suggested load with the buffer for spot sales. */
  suggested: number;
  /** Sellable in the loading warehouse. */
  warehouse: number;
  /** Already loaded for this trip. */
  loaded: number;
  /** First-expiry-first batches the load would take. */
  picks: { batch: string; expiry: Date | null; qty: number }[];
};

/** Load sheet for a trip: orders + buffer − what is already in the van, with FEFO batches. */
export async function loadPlan(ctx: Ctx, tripId: string) {
  const trip = await ctx.tx.trip.findUnique({ where: { id: tripId }, include: { vehicle: { select: { id: true, number: true } } } });
  if (!trip) throw new MoneyError("Trip not found", 404);
  const s = await stockSettings(ctx.tx, ctx.tenantId);
  if (!s.enabled || !trip.vehicle) return { enabled: s.enabled, vehicle: trip.vehicle, status: trip.status, warehouse: null, rows: [] as LoadRow[] };
  const van = await vanLocation(ctx, trip.vehicle.id);
  const wh = await defaultWarehouse(ctx);
  const [mine, all, inVan, loaded] = await Promise.all([
    vanNeeds(ctx.tx, trip.vehicle.id, tripId),
    vanNeeds(ctx.tx, trip.vehicle.id),
    sellableAt(ctx.tx, van.id),
    ctx.tx.stockMove.groupBy({ by: ["productId"], where: { tripId, kind: "LOAD" }, _sum: { qty: true } }),
  ]);
  const ids = [...new Set([...mine.keys(), ...[...inVan.entries()].filter(([, q]) => q > 0).map(([id]) => id)])];
  const [products, whLots] = await Promise.all([
    ctx.tx.product.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, unit: true, caseSize: true } }),
    ctx.tx.stockLot.findMany({ where: { locationId: wh.id, productId: { in: ids }, qty: { gt: 0 } } }),
  ]);
  const today = istToday();
  const rows: LoadRow[] = products.map((p) => {
    const need = mine.get(p.id) ?? 0;
    const otherNeed = (all.get(p.id) ?? 0) - need;
    const have = inVan.get(p.id) ?? 0;
    const l = loadLine({ need, otherNeed, inVan: have, bufferPct: s.bufferPct, caseSize: p.caseSize });
    const lots = whLots.filter((x) => x.productId === p.id);
    const warehouse = lots.filter((x) => !isExpired(x, today)).reduce((a, x) => a + x.qty, 0);
    const { picks } = pickFefo(lots, l.suggested, { today });
    return {
      productId: p.id,
      name: p.name,
      unit: p.unit,
      caseSize: p.caseSize,
      need,
      otherNeed,
      inVan: have,
      buffer: l.buffer,
      forOrders: l.forOrders,
      suggested: l.suggested,
      warehouse,
      loaded: loaded.find((g) => g.productId === p.id)?._sum.qty ?? 0,
      picks: picks.map((x) => ({ batch: x.lot.batch, expiry: x.lot.expiry, qty: x.qty })),
    };
  });
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return { enabled: true, vehicle: trip.vehicle, status: trip.status, warehouse: { id: wh.id, name: wh.name }, van: { id: van.id, name: van.name }, rows };
}

/**
 * Load goods on a trip's van from the loading warehouse. With override,
 * quantities the records don't show are booked in first ("records were
 * short at loading") instead of refusing.
 */
export async function loadVan(ctx: Ctx, tripId: string, rows: { productId: string; qty: number }[], opts: { override?: boolean } = {}) {
  await requireStock(ctx);
  const trip = await ctx.tx.trip.findUnique({ where: { id: tripId } });
  if (!trip) throw new MoneyError("Trip not found", 404);
  if (trip.status === "CLOSED") throw new MoneyError("This trip is closed");
  if (!trip.vehicleId) throw new MoneyError("Pick a van for this trip first");
  const van = await vanLocation(ctx, trip.vehicleId);
  const wh = await defaultWarehouse(ctx);
  const todo = rows.filter((r) => r.qty > 0);
  if (!todo.length) throw new MoneyError("Nothing to load");
  if (!opts.override) {
    const have = await sellableAt(ctx.tx, wh.id, todo.map((r) => r.productId));
    const short = [];
    for (const r of todo) {
      const h = have.get(r.productId) ?? 0;
      if (r.qty > h) {
        const p = await productInfo(ctx, r.productId);
        short.push({ productId: r.productId, name: p.name, unit: p.unit, need: r.qty, have: h });
      }
    }
    if (short.length) {
      throw new MoneyError(
        `Not enough in ${wh.name}: ${short.map((x) => `${x.name} (need ${x.need}, have ${x.have})`).join(", ")}. Record the stock, or load anyway if the goods are there.`,
        409,
        { stockShort: short }
      );
    }
  }
  for (const r of todo) {
    await stockTransfer(ctx, {
      kind: "LOAD",
      fromId: wh.id,
      toId: van.id,
      productId: r.productId,
      qty: r.qty,
      tripId,
      onShort: opts.override ? "correct" : "refuse",
      correctReason: "loaded_unrecorded",
    });
  }
  return todo.length;
}

/** Top the van up so it covers every open stop of the trip (used when the trip starts). */
export async function ensureLoaded(ctx: Ctx, tripId: string, opts: { override?: boolean } = {}) {
  const s = await stockOn(ctx);
  if (!s) return 0;
  const plan = await loadPlan(ctx, tripId);
  if (!plan.vehicle) return 0;
  const rows = plan.rows.filter((r) => r.forOrders > 0).map((r) => ({ productId: r.productId, qty: r.forOrders }));
  return rows.length ? loadVan(ctx, tripId, rows, opts) : 0;
}

/**
 * Unload a van after its trip: good goods back to the warehouse, damaged to
 * the damaged bin, the rest kept in the van. What the counts don't account
 * for is written off as missing from the van (or booked in when more came back).
 */
export async function unloadVan(
  ctx: Ctx,
  vehicleId: string,
  rows: { productId: string; good: number; damaged: number; keep: number }[],
  opts: { tripId?: string | null; note?: string | null } = {}
) {
  await requireStock(ctx);
  const running = await ctx.tx.trip.findFirst({ where: { vehicleId, status: "STARTED" }, select: { number: true } });
  if (running) throw new MoneyError(`Trip ${running.number} on this van is still running. Close it first.`);
  const van = await vanLocation(ctx, vehicleId);
  const wh = await defaultWarehouse(ctx);
  const bin = await damagedBin(ctx);
  const refs = { tripId: opts.tripId ?? null, note: opts.note ?? null };
  const result = { back: 0, damaged: 0, kept: 0, missing: [] as { productId: string; qty: number }[], found: [] as { productId: string; qty: number }[] };
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.productId)) throw new MoneyError("Each product can appear once");
    seen.add(r.productId);
    for (const n of [r.good, r.damaged, r.keep]) if (!Number.isInteger(n) || n < 0 || n > MAX_QTY) throw new MoneyError("Counts must be whole numbers");
    await lock(ctx, [[van.id, r.productId]]);
    const lots = await ctx.tx.stockLot.findMany({ where: { locationId: van.id, productId: r.productId, qty: { gt: 0 } }, select: { qty: true } });
    const onHand = lots.reduce((a, l) => a + l.qty, 0);
    const counted = r.good + r.damaged + r.keep;
    if (counted > onHand) {
      await stockIn(ctx, { kind: "ADJUST", locationId: van.id, productId: r.productId, qty: counted - onHand, reason: "van_found", ...refs });
      result.found.push({ productId: r.productId, qty: counted - onHand });
    }
    // Damaged first: first-expiry-first sends expired lots to the bin.
    if (r.damaged > 0) {
      await stockTransfer(ctx, { kind: "DAMAGE", fromId: van.id, toId: bin.id, productId: r.productId, qty: r.damaged, allowExpired: true, onShort: "refuse", ...refs, reason: "damaged" });
      result.damaged += r.damaged;
    }
    if (r.good > 0) {
      await stockTransfer(ctx, { kind: "UNLOAD", fromId: van.id, toId: wh.id, productId: r.productId, qty: r.good, allowExpired: true, onShort: "refuse", ...refs });
      result.back += r.good;
    }
    if (onHand > counted) {
      await stockOut(ctx, { kind: "ADJUST", sources: [van.id], productId: r.productId, qty: onHand - counted, allowExpired: true, onShort: "refuse", ...refs, reason: "van_shortage" });
      result.missing.push({ productId: r.productId, qty: onHand - counted });
    }
    result.kept += r.keep;
  }
  return result;
}

/**
 * Suggested unload counts after a trip: everything back, with lines the
 * driver delivered short as damaged / expired counted as damaged.
 */
export async function unloadPlan(ctx: Ctx, tripId: string) {
  const trip = await ctx.tx.trip.findUnique({ where: { id: tripId }, select: { vehicleId: true, status: true } });
  if (!trip) throw new MoneyError("Trip not found", 404);
  if (!trip.vehicleId) return { vehicleId: null, rows: [] };
  const { rows } = await vanStock(ctx, trip.vehicleId);
  const shortItems = await ctx.tx.orderItem.findMany({
    where: { order: { delivery: { tripId, state: "DELIVERED" } }, shortReason: { in: ["damaged", "expired"] } },
    select: { productId: true, quantity: true, orderedQty: true, deliveredQty: true },
  });
  const damaged = new Map<string, number>();
  for (const i of shortItems) {
    const n = (i.orderedQty ?? i.quantity) - (i.deliveredQty ?? i.quantity);
    if (n > 0) damaged.set(i.productId, (damaged.get(i.productId) ?? 0) + n);
  }
  return {
    vehicleId: trip.vehicleId,
    rows: rows.map((r) => {
      const d = Math.min(r.onHand, damaged.get(r.productId) ?? 0);
      return { productId: r.productId, name: r.name, unit: r.unit, onHand: r.onHand, expired: r.expired, reserved: r.reserved, good: r.onHand - d, damaged: d, keep: 0 };
    }),
  };
}

// ───────────────────────────── orders ─────────────────────────────

/**
 * Goods handed over at a delivery: sold from the trip's van first, then the
 * loading warehouse. Never refuses: missing units are booked in first.
 */
export async function sellDelivered(ctx: Ctx, orderId: string, lines: { itemId: string; productId: string; qty: number }[], tripId: string | null) {
  if (!(await stockOn(ctx))) return;
  const trip = tripId ? await ctx.tx.trip.findUnique({ where: { id: tripId }, select: { vehicleId: true } }) : null;
  const sources: string[] = [];
  if (trip?.vehicleId) sources.push((await vanLocation(ctx, trip.vehicleId)).id);
  sources.push((await defaultWarehouse(ctx)).id);
  for (const l of lines) {
    if (l.qty <= 0) continue;
    await stockOut(ctx, { kind: "SALE", sources, productId: l.productId, qty: l.qty, onShort: "correct", correctReason: "sold_unrecorded", orderId, orderItemId: l.itemId, tripId });
  }
}

/**
 * A return credit note on a delivered order: the goods come back into stock
 * (good → loading warehouse, damaged / expired → damaged bin), in the batch
 * they were sold from. Never more than was sold less what already came back.
 */
export async function restockReturn(ctx: Ctx, noteId: string, condition: ReturnCondition) {
  if (!(await stockOn(ctx))) return [];
  if (!isReturnCondition(condition)) throw new MoneyError("Pick the condition of the returned goods");
  const note = await ctx.tx.invoice.findUnique({ where: { id: noteId }, include: { lines: true, order: { select: { id: true, status: true } } } });
  if (!note || note.type !== "CREDIT_NOTE") throw new MoneyError("Credit note not found", 404);
  if (!note.order || note.order.status !== "DELIVERED") return [];
  const dest = condition === "good" ? await defaultWarehouse(ctx) : await damagedBin(ctx);
  const done: { productId: string; qty: number }[] = [];
  for (const l of note.lines) {
    if (!l.orderItemId || !l.productId || !l.quantity) continue;
    const moves = await ctx.tx.stockMove.findMany({ where: { orderItemId: l.orderItemId, kind: { in: ["SALE", "RETURN"] } }, include: { lot: true }, orderBy: { createdAt: "desc" } });
    const sold = moves.filter((m) => m.kind === "SALE").reduce((a, m) => a + m.qty, 0);
    const back = moves.filter((m) => m.kind === "RETURN").reduce((a, m) => a + m.qty, 0);
    const qty = Math.min(Math.round(l.quantity), sold - back);
    if (qty <= 0) continue;
    const lot = moves.find((m) => m.kind === "SALE")?.lot;
    await stockIn(ctx, {
      kind: "RETURN",
      locationId: dest.id,
      productId: l.productId,
      qty,
      lot: lot ? { batch: lot.batch, expiry: lot.expiry, mfgDate: lot.mfgDate, unitCost: lot.unitCost } : {},
      orderId: note.order.id,
      orderItemId: l.orderItemId,
      docId: note.id,
      reason: condition,
    });
    done.push({ productId: l.productId, qty });
  }
  return done;
}

// ───────────────────────────── purchases ─────────────────────────────

const YMD = /^\d{4}-\d{2}-\d{2}$/;
function parseDay(v: unknown, what: string): Date | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string" || !YMD.test(v) || Number.isNaN(new Date(`${v}T00:00:00Z`).getTime())) throw new MoneyError(`${what} must be a date`);
  return new Date(`${v}T00:00:00.000Z`);
}
const optCost = (v: unknown) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 100_000_000_00) throw new MoneyError("Cost must be whole paise");
  return n;
};

export type ReceiveLine = { productId: string; quantity: number; batch?: string | null; expiry?: string | null; mfgDate?: string | null; unitCost?: number | null };

/** Goods received from a supplier (GRN): stock in, batch by batch, against a purchase order or not. */
export async function receiveGoods(
  ctx: Ctx,
  input: { supplierId: string; locationId?: string | null; poId?: string | null; billNo?: string | null; billDate?: string | null; note?: string | null; lines: ReceiveLine[] },
  now = new Date()
) {
  await requireStock(ctx);
  const supplier = await ctx.tx.supplier.findUnique({ where: { id: input.supplierId } });
  if (!supplier || !supplier.active) throw new MoneyError("Supplier not found", 404);
  const loc = input.locationId ? await place(ctx, input.locationId, ["WAREHOUSE"]) : await defaultWarehouse(ctx);
  if (!Array.isArray(input.lines) || input.lines.length === 0 || input.lines.length > 300) throw new MoneyError("Add 1 to 300 lines");
  const po = input.poId ? await ctx.tx.purchaseOrder.findUnique({ where: { id: input.poId }, include: { lines: true } }) : null;
  if (input.poId) {
    if (!po) throw new MoneyError("Purchase order not found", 404);
    if (po.supplierId !== supplier.id) throw new MoneyError("That purchase order is for another supplier");
    if (po.status === "CANCELLED" || po.status === "RECEIVED") throw new MoneyError(`Purchase order ${po.number} is ${po.status.toLowerCase()}`);
  }
  const today = istToday(now);
  const lines = [];
  for (const raw of input.lines) {
    const p = await ctx.tx.product.findUnique({ where: { id: String(raw.productId) }, select: { id: true, name: true, trackExpiry: true } });
    if (!p) throw new MoneyError("Product not found", 404);
    const quantity = Number(raw.quantity);
    assertQty(quantity, `${p.name}: quantity`);
    const expiry = parseDay(raw.expiry, `${p.name}: expiry`);
    const mfgDate = parseDay(raw.mfgDate, `${p.name}: manufacturing date`);
    if (p.trackExpiry && !expiry) throw new MoneyError(`${p.name}: enter the expiry date`);
    if (expiry && expiry < today) throw new MoneyError(`${p.name}: this batch has already expired`);
    if (mfgDate && mfgDate > today) throw new MoneyError(`${p.name}: manufacturing date is in the future`);
    lines.push({ productId: p.id, quantity, batch: String(raw.batch ?? "").trim().slice(0, 40), expiry, mfgDate, unitCost: optCost(raw.unitCost) });
  }
  const fy = fyCode(now);
  const number = docNumber("GRN", fy, await nextSequence(ctx.tx, ctx.tenantId, `grn:${fy}`));
  const purchase = await ctx.tx.purchase.create({
    data: {
      number,
      supplierId: supplier.id,
      locationId: loc.id,
      poId: po?.id ?? null,
      billNo: input.billNo?.trim().slice(0, 40) || null,
      billDate: parseDay(input.billDate, "Bill date"),
      note: input.note?.trim().slice(0, 300) || null,
      total: lines.reduce((a, l) => a + l.quantity * (l.unitCost ?? 0), 0),
      createdById: ctx.actorId,
    },
  });
  for (const l of lines) {
    const lot = await stockIn(ctx, {
      kind: "PURCHASE",
      locationId: loc.id,
      productId: l.productId,
      qty: l.quantity,
      lot: { batch: l.batch, expiry: l.expiry, mfgDate: l.mfgDate, unitCost: l.unitCost },
      purchaseId: purchase.id,
      docId: po?.id ?? null,
    });
    await ctx.tx.purchaseLine.create({ data: { purchaseId: purchase.id, ...l, lotId: lot.id } });
    if (l.unitCost !== null) await ctx.tx.product.update({ where: { id: l.productId }, data: { lastCost: l.unitCost } });
  }
  if (po) {
    for (const l of lines) {
      let left = l.quantity;
      for (const pl of po.lines.filter((x) => x.productId === l.productId)) {
        if (left <= 0) break;
        const take = Math.max(0, Math.min(left, pl.quantity - pl.receivedQty));
        if (take > 0) {
          await ctx.tx.purchaseOrderLine.update({ where: { id: pl.id }, data: { receivedQty: { increment: take } } });
          pl.receivedQty += take;
          left -= take;
        }
      }
    }
    const done = po.lines.every((pl) => pl.receivedQty >= pl.quantity);
    await ctx.tx.purchaseOrder.update({ where: { id: po.id }, data: { status: done ? "RECEIVED" : "PARTLY_RECEIVED" } });
  }
  return ctx.tx.purchase.findUniqueOrThrow({ where: { id: purchase.id }, include: { lines: true } });
}

export type PoLineInput = { productId: string; quantity: number; unitCost?: number | null };

async function poLines(ctx: Ctx, lines: PoLineInput[]) {
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > 300) throw new MoneyError("Add 1 to 300 lines");
  const out = [];
  const seen = new Set<string>();
  for (const l of lines) {
    const p = await ctx.tx.product.findUnique({ where: { id: String(l.productId) }, select: { id: true, name: true } });
    if (!p) throw new MoneyError("Product not found", 404);
    if (seen.has(p.id)) throw new MoneyError(`${p.name} is on the order twice`);
    seen.add(p.id);
    const quantity = Number(l.quantity);
    assertQty(quantity, `${p.name}: quantity`);
    out.push({ productId: p.id, quantity, unitCost: optCost(l.unitCost) });
  }
  return out;
}

export async function createPo(ctx: Ctx, input: { supplierId: string; expectedDate?: string | null; note?: string | null; lines: PoLineInput[] }, now = new Date()) {
  const supplier = await ctx.tx.supplier.findUnique({ where: { id: input.supplierId } });
  if (!supplier || !supplier.active) throw new MoneyError("Supplier not found", 404);
  const lines = await poLines(ctx, input.lines);
  const fy = fyCode(now);
  const number = docNumber("PO", fy, await nextSequence(ctx.tx, ctx.tenantId, `po:${fy}`));
  return ctx.tx.purchaseOrder.create({
    data: {
      number,
      supplierId: supplier.id,
      expectedDate: parseDay(input.expectedDate, "Expected date"),
      note: input.note?.trim().slice(0, 500) || null,
      createdById: ctx.actorId,
      lines: { create: lines },
    },
    include: { lines: true },
  });
}

/** Edit a draft purchase order (lines are replaced when given). */
export async function updatePo(ctx: Ctx, id: string, input: { expectedDate?: string | null; note?: string | null; lines?: PoLineInput[] }) {
  const po = await ctx.tx.purchaseOrder.findUnique({ where: { id } });
  if (!po) throw new MoneyError("Purchase order not found", 404);
  if (po.status !== "DRAFT") throw new MoneyError("Only a draft purchase order can be changed");
  const data: Record<string, unknown> = {};
  if (input.expectedDate !== undefined) data.expectedDate = parseDay(input.expectedDate, "Expected date");
  if (input.note !== undefined) data.note = input.note?.trim().slice(0, 500) || null;
  if (input.lines) {
    const lines = await poLines(ctx, input.lines);
    await ctx.tx.purchaseOrderLine.deleteMany({ where: { poId: id } });
    data.lines = { create: lines };
  }
  return ctx.tx.purchaseOrder.update({ where: { id }, data, include: { lines: true } });
}

export async function setPoStatus(ctx: Ctx, id: string, status: "SENT" | "CANCELLED", now = new Date()) {
  const po = await ctx.tx.purchaseOrder.findUnique({ where: { id } });
  if (!po) throw new MoneyError("Purchase order not found", 404);
  if (status === "SENT") {
    if (po.status !== "DRAFT") throw new MoneyError("Only a draft can be marked sent");
    return ctx.tx.purchaseOrder.update({ where: { id }, data: { status, sentAt: now } });
  }
  if (po.status === "RECEIVED" || po.status === "CANCELLED") throw new MoneyError(`This purchase order is already ${po.status.toLowerCase()}`);
  return ctx.tx.purchaseOrder.update({ where: { id }, data: { status } });
}

export type ReorderRow = {
  productId: string;
  name: string;
  sku: string;
  unit: string;
  caseSize: number | null;
  available: number;
  onOrder: number;
  reorderLevel: number;
  suggested: number;
  supplierId: string | null;
  supplierName: string | null;
  lastCost: number | null;
};

/** Products at or below their reorder level (counting what is already on order). */
export async function reorderList(tx: Tx): Promise<ReorderRow[]> {
  const products = await tx.product.findMany({
    where: { active: true, reorderLevel: { not: null } },
    select: { id: true, name: true, sku: true, unit: true, caseSize: true, reorderLevel: true, reorderQty: true, supplierId: true, lastCost: true, supplier: { select: { name: true } } },
  });
  if (!products.length) return [];
  const ids = products.map((p) => p.id);
  const [levels, open] = await Promise.all([
    stockLevels(tx, ids),
    tx.purchaseOrderLine.findMany({ where: { productId: { in: ids }, po: { status: { in: ["DRAFT", "SENT", "PARTLY_RECEIVED"] } } }, select: { productId: true, quantity: true, receivedQty: true } }),
  ]);
  const onOrder = new Map<string, number>();
  for (const l of open) onOrder.set(l.productId, (onOrder.get(l.productId) ?? 0) + Math.max(0, l.quantity - l.receivedQty));
  const rows: ReorderRow[] = [];
  for (const p of products) {
    const available = levels.get(p.id)?.available ?? 0;
    const o = onOrder.get(p.id) ?? 0;
    if (available > p.reorderLevel!) continue;
    rows.push({
      productId: p.id,
      name: p.name,
      sku: p.sku,
      unit: p.unit,
      caseSize: p.caseSize,
      available,
      onOrder: o,
      reorderLevel: p.reorderLevel!,
      suggested: reorderSuggestion({ available: available + o, reorderLevel: p.reorderLevel, reorderQty: p.reorderQty, caseSize: p.caseSize }),
      supplierId: p.supplierId,
      supplierName: p.supplier?.name ?? null,
      lastCost: p.lastCost,
    });
  }
  return rows.sort((a, b) => a.available - a.reorderLevel - (b.available - b.reorderLevel));
}

/** Draft purchase orders from the reorder list, one per supplier (products without a supplier are skipped). */
export async function draftReorderPos(ctx: Ctx, productIds?: string[], now = new Date()) {
  const rows = (await reorderList(ctx.tx)).filter((r) => r.suggested > 0 && (!productIds || productIds.includes(r.productId)));
  const bySupplier = new Map<string, ReorderRow[]>();
  const skipped: string[] = [];
  for (const r of rows) {
    if (!r.supplierId) skipped.push(r.name);
    else bySupplier.set(r.supplierId, [...(bySupplier.get(r.supplierId) ?? []), r]);
  }
  const pos = [];
  for (const [supplierId, list] of bySupplier) {
    pos.push(await createPo(ctx, { supplierId, lines: list.map((r) => ({ productId: r.productId, quantity: r.suggested, unitCost: r.lastCost })) }, now));
  }
  return { pos, skipped };
}

// ───────────────────────────── adjustments ─────────────────────────────

/** Count correction, found, lost … : + adds to a lot (new batch allowed), − takes from a lot or first expiry first. */
export async function adjustStock(
  ctx: Ctx,
  a: { locationId: string; productId: string; delta: number; reason: string; note?: string | null; lotId?: string | null; batch?: string | null; expiry?: string | null; unitCost?: number | null }
) {
  await requireStock(ctx);
  if (!isAdjustReason(a.reason)) throw new MoneyError("Pick a reason");
  if (a.reason === "other" && !a.note?.trim()) throw new MoneyError("Write what happened");
  const delta = Number(a.delta);
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > MAX_QTY) throw new MoneyError("Change must be a whole number, not 0");
  const loc = await place(ctx, a.locationId);
  await productInfo(ctx, a.productId);
  const lot = a.lotId ? await ctx.tx.stockLot.findUnique({ where: { id: a.lotId } }) : null;
  if (a.lotId && (!lot || lot.locationId !== loc.id || lot.productId !== a.productId)) throw new MoneyError("Batch not found here", 404);
  const kind = a.reason === "opening" ? "OPENING" : "ADJUST";
  if (delta > 0) {
    const p = await productInfo(ctx, a.productId);
    const spec = lot
      ? { batch: lot.batch, expiry: lot.expiry, mfgDate: lot.mfgDate, unitCost: lot.unitCost }
      : { batch: a.batch ?? "", expiry: parseDay(a.expiry, "Expiry"), unitCost: optCost(a.unitCost) ?? p.lastCost };
    return stockIn(ctx, { kind, locationId: loc.id, productId: a.productId, qty: delta, lot: spec, reason: a.reason, note: a.note });
  }
  return stockOut(ctx, { kind, sources: [loc.id], productId: a.productId, qty: -delta, lotId: a.lotId, allowExpired: true, onShort: "refuse", reason: a.reason, note: a.note });
}

/** Damaged or expired goods to the damaged bin. */
export async function damageStock(ctx: Ctx, a: { locationId: string; productId: string; qty: number; reason: string; lotId?: string | null; note?: string | null }) {
  await requireStock(ctx);
  if (!isDamageReason(a.reason)) throw new MoneyError("Pick a reason");
  const loc = await place(ctx, a.locationId, ["WAREHOUSE", "VAN"]);
  const bin = await damagedBin(ctx);
  return stockTransfer(ctx, { kind: "DAMAGE", fromId: loc.id, toId: bin.id, productId: a.productId, qty: Number(a.qty), lotId: a.lotId, allowExpired: true, onShort: "refuse", reason: a.reason, note: a.note });
}

/** Every expired batch in the warehouses to the damaged bin. */
export async function binExpired(ctx: Ctx) {
  await requireStock(ctx);
  const bin = await damagedBin(ctx);
  const today = istToday();
  const lots = await ctx.tx.stockLot.findMany({ where: { qty: { gt: 0 }, expiry: { lt: today }, location: { kind: "WAREHOUSE" } } });
  for (const l of lots) {
    await stockTransfer(ctx, { kind: "DAMAGE", fromId: l.locationId, toId: bin.id, productId: l.productId, qty: l.qty, lotId: l.id, allowExpired: true, onShort: "refuse", reason: "expired" });
  }
  return lots.length;
}

/** Out of the damaged bin: written off, or sent back to the supplier. */
export async function clearDamaged(ctx: Ctx, a: { productId: string; qty: number; lotId?: string | null; to: "WRITE_OFF" | "SUPPLIER_RETURN"; supplierId?: string | null; note?: string | null }) {
  await requireStock(ctx);
  const bin = await damagedBin(ctx);
  let note = a.note ?? null;
  if (a.to === "SUPPLIER_RETURN") {
    const s = a.supplierId ? await ctx.tx.supplier.findUnique({ where: { id: a.supplierId } }) : null;
    if (!s) throw new MoneyError("Pick the supplier");
    note = `To ${s.name}${note ? `: ${note}` : ""}`;
  }
  return stockOut(ctx, { kind: a.to, sources: [bin.id], productId: a.productId, qty: Number(a.qty), lotId: a.lotId, allowExpired: true, onShort: "refuse", note, docId: a.supplierId ?? null });
}

/** Between two warehouses (vans use load / unload). */
export async function transferStock(ctx: Ctx, a: { fromId: string; toId: string; productId: string; qty: number; lotId?: string | null; note?: string | null }) {
  await requireStock(ctx);
  await place(ctx, a.fromId, ["WAREHOUSE"]);
  await place(ctx, a.toId, ["WAREHOUSE"]);
  return stockTransfer(ctx, { kind: "TRANSFER", fromId: a.fromId, toId: a.toId, productId: a.productId, qty: Number(a.qty), lotId: a.lotId, allowExpired: true, onShort: "refuse", note: a.note });
}

// ───────────────────────────── alerts ─────────────────────────────

/** Counts for the dashboard: products to reorder, batches expiring soon, expired batches still in stock. */
export async function stockAlerts(tx: Tx, tenantSettings: unknown) {
  const s = inventorySettings(tenantSettings);
  if (!s.enabled) return null;
  const today = istToday();
  const [reorder, soon, expired] = await Promise.all([
    reorderList(tx),
    tx.stockLot.count({ where: { qty: { gt: 0 }, expiry: { gte: today, lte: addDays(today, s.expiryAlertDays) }, location: { kind: { in: ["WAREHOUSE", "VAN"] } } } }),
    tx.stockLot.count({ where: { qty: { gt: 0 }, expiry: { lt: today }, location: { kind: { in: ["WAREHOUSE", "VAN"] } } } }),
  ]);
  return { reorder: reorder.length, expiringSoon: soon, expired };
}
