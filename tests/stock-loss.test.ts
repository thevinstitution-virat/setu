/**
 * Stock losses shown in the books (T3) against the real database: damage,
 * expiry, damaged returns, write-offs and manual adjustments post their cost
 * between Purchases and Stock loss; the closing stock falls by exactly the
 * loss posted, profit is unchanged, damaged goods sent back to the company
 * take their loss back (also through a debit note from the damaged bin), and
 * nothing posts without the books module. Runs in the demo tenant at a fresh
 * place with fresh products; settings and overrides are put back.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/db";
import { withMoney, type Ctx } from "@/lib/ledger";
import { checkBooks, ensureBooks, todayIst } from "@/lib/books";
import { adjustStock, clearDamaged, damageStock, damagedBin, stockIn } from "@/lib/stock";
import { stockValuation } from "@/lib/stock-counts";
import { lossSign } from "@/lib/stock-loss";
import { recordPurchase } from "@/lib/purchases";
import { invalidateEntitlements } from "@/lib/plans";

let T = "";
let adminId = "";
let originalSettings: unknown = null;
let originalOverrides: unknown = null;
let tenantState = "27";
const run = Date.now().toString().slice(-6);
const today = todayIst();
const as = <R>(fn: (ctx: Ctx) => Promise<R>) => withMoney(T, adminId, fn);
const ids = { place: "", cat: "", supplier: "", a: "", b: "" };

async function setBooks(on: boolean) {
  const t = await prisma.tenant.findUniqueOrThrow({ where: { id: T }, select: { overrides: true } });
  const o = (t.overrides ?? {}) as Record<string, unknown>;
  await prisma.tenant.update({ where: { id: T }, data: { overrides: { ...o, features: { ...((o.features as object) ?? {}), books: on } } as object } });
  invalidateEntitlements(T);
}
const placeValue = async () => (await as((ctx) => stockValuation(ctx, { day: today, by: "company", locationId: ids.place }))).total;
/** The entries this product's moves posted, newest last, with their lines by account type. */
async function entriesFor(productId: string) {
  const db = tenantDb(T);
  const moves = await db.stockMove.findMany({ where: { productId, entryId: { not: null } }, orderBy: { createdAt: "asc" } });
  const out: { entryId: string; kind: string; value: number; lines: Record<string, number>; memo: string | null }[] = [];
  for (const id of [...new Set(moves.map((m) => m.entryId!))]) {
    const e = await db.journalEntry.findUniqueOrThrow({ where: { id }, include: { lines: { include: { account: true } } } });
    out.push({
      entryId: id,
      kind: e.kind,
      memo: e.memo,
      value: moves.filter((m) => m.entryId === id).reduce((s, m) => s + (m.bookValue ?? 0), 0),
      lines: Object.fromEntries(e.lines.map((l) => [l.account.type, l.amount])),
    });
  }
  return out;
}
const last = async (productId: string) => (await entriesFor(productId)).at(-1)!;
const count = async (productId: string) => (await entriesFor(productId)).length;
const lotAt = (locationId: string, productId: string) => tenantDb(T).stockLot.findFirstOrThrow({ where: { locationId, productId, qty: { gt: 0 } } });

beforeAll(async () => {
  const demo = await prisma.tenant.findUniqueOrThrow({ where: { slug: "demo" }, select: { id: true, settings: true, overrides: true, stateCode: true } });
  T = demo.id;
  originalSettings = demo.settings;
  originalOverrides = demo.overrides;
  tenantState = demo.stateCode ?? "27";
  const db = tenantDb(T);
  adminId = (await db.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id;
  const s = (demo.settings ?? {}) as Record<string, unknown>;
  await prisma.tenant.update({
    where: { id: T },
    data: { booksLockedUntil: null, settings: { ...s, inventory: { enabled: true, orderCheck: "warn", bufferPct: 10, expiryAlertDays: 7 } } as object },
  });
  await setBooks(true);
  await as((ctx) => ensureBooks(ctx));
  ids.place = (await db.stockLocation.create({ data: { kind: "WAREHOUSE", name: `Test loss godown ${run}` } })).id;
  ids.cat = (await db.category.create({ data: { name: `Test loss cat ${run}` } })).id;
  ids.supplier = (await db.supplier.create({ data: { name: `Test loss company ${run}`, kind: "GOODS", stateCode: tenantState } })).id;
  const mk = (sku: string, lastCost: number | null) =>
    db.product.create({ data: { name: `Test loss ${sku} ${run}`, sku: `LOSS-${sku}-${run}`, categoryId: ids.cat, supplierId: ids.supplier, unit: "pc", price: 20000, mrp: 30000, gstRate: 18, lastCost } });
  ids.a = (await mk("A", 9000)).id;
  ids.b = (await mk("B", 5000)).id;
  await as((ctx) => adjustStock(ctx, { locationId: ids.place, productId: ids.a, delta: 20, reason: "opening", batch: "A1", unitCost: 10000 }));
  await as((ctx) => adjustStock(ctx, { locationId: ids.place, productId: ids.b, delta: 10, reason: "opening", batch: "" }));
  // B's batch has no cost of its own: it is valued at the last cost.
  await db.stockLot.updateMany({ where: { locationId: ids.place, productId: ids.b }, data: { unitCost: null } });
});

afterAll(async () => {
  if (!T) return;
  await prisma.tenant.update({ where: { id: T }, data: { settings: originalSettings as object, overrides: originalOverrides as object, booksLockedUntil: null } });
  invalidateEntitlements(T);
  const db = tenantDb(T);
  await db.product.updateMany({ where: { id: { in: [ids.a, ids.b] } }, data: { active: false } });
  await db.supplier.updateMany({ where: { id: ids.supplier }, data: { active: false } });
  await db.stockLocation.updateMany({ where: { id: ids.place }, data: { active: false } });
});

describe("which moves post", () => {
  it("losses, surpluses and the ones that only correct the records", () => {
    expect(lossSign("DAMAGE", "expired", "WAREHOUSE", "DAMAGED")).toBe(1);
    expect(lossSign("DAMAGE", "damaged", "VAN", "DAMAGED")).toBe(1);
    expect(lossSign("RETURN", "damaged", null, "DAMAGED")).toBe(1);
    expect(lossSign("RETURN", "good", null, "WAREHOUSE")).toBe(0);
    expect(lossSign("WRITE_OFF", null, "DAMAGED", null)).toBe(0);
    expect(lossSign("WRITE_OFF", null, "WAREHOUSE", null)).toBe(1);
    expect(lossSign("SUPPLIER_RETURN", null, "DAMAGED", null)).toBe(-1);
    expect(lossSign("SUPPLIER_RETURN", null, "WAREHOUSE", null)).toBe(0);
    expect(lossSign("ADJUST", "lost", "WAREHOUSE", null)).toBe(1);
    expect(lossSign("ADJUST", "found", null, "WAREHOUSE")).toBe(-1);
    expect(lossSign("ADJUST", "van_shortage", "VAN", null)).toBe(1);
    expect(lossSign("ADJUST", "lost", "DAMAGED", null)).toBe(0);
    for (const r of ["count", "opening", "sold_unrecorded", "loaded_unrecorded"]) expect(lossSign("ADJUST", r, "WAREHOUSE", null)).toBe(0);
    for (const k of ["PURCHASE", "SALE", "LOAD", "UNLOAD", "TRANSFER", "OPENING"] as const) expect(lossSign(k, null, "WAREHOUSE", "VAN")).toBe(0);
  });
});

describe("stock losses in the books", () => {
  it("opening stock posts nothing", async () => {
    expect(await count(ids.a)).toBe(0);
    expect(await count(ids.b)).toBe(0);
  });

  it("damaged goods: the loss at the batch's cost, and the closing stock falls by exactly that", async () => {
    const before = await placeValue();
    await as((ctx) => damageStock(ctx, { locationId: ids.place, productId: ids.a, qty: 3, reason: "damaged" }));
    const e = await last(ids.a);
    expect(e.kind).toBe("STOCK_MOVE");
    expect(e.value).toBe(30000);
    expect(e.lines).toEqual({ STOCK_LOSS: 30000, PURCHASES: -30000 });
    expect(e.memo).toMatch(/Stock loss, to damaged \(damaged\): 3 pc of Test loss A/);
    expect(before - (await placeValue())).toBe(30000);
  });

  it("an expired batch to the damaged bin, and a lost unit with no batch cost (last cost)", async () => {
    const before = await placeValue();
    await as((ctx) => damageStock(ctx, { locationId: ids.place, productId: ids.a, qty: 1, reason: "expired" }));
    expect((await last(ids.a)).memo).toMatch(/expired/);
    await as((ctx) => adjustStock(ctx, { locationId: ids.place, productId: ids.b, delta: -2, reason: "lost" }));
    expect((await last(ids.b)).lines).toEqual({ STOCK_LOSS: 10000, PURCHASES: -10000 });
    expect(before - (await placeValue())).toBe(10000 + 10000);
  });

  it("goods found: a surplus the other way; a count correction posts nothing of its own", async () => {
    const before = await placeValue();
    await as((ctx) => adjustStock(ctx, { locationId: ids.place, productId: ids.b, delta: 4, reason: "found" }));
    const e = await last(ids.b);
    expect(e.lines).toEqual({ STOCK_LOSS: -20000, PURCHASES: 20000 });
    expect(e.memo).toMatch(/^Stock surplus/);
    expect((await placeValue()) - before).toBe(20000);
    const n = await count(ids.b);
    await as((ctx) => adjustStock(ctx, { locationId: ids.place, productId: ids.b, delta: -1, reason: "count" }));
    expect(await count(ids.b)).toBe(n);
  });

  it("a shop's damaged return into the damaged bin is a loss; written off from the bin, nothing more", async () => {
    const bin = await as((ctx) => damagedBin(ctx));
    await as((ctx) => stockIn(ctx, { kind: "RETURN", locationId: bin.id, productId: ids.b, qty: 1, lot: { unitCost: 5000 }, reason: "damaged" }));
    expect((await last(ids.b)).lines).toEqual({ STOCK_LOSS: 5000, PURCHASES: -5000 });
    const n = await count(ids.b);
    const lot = await lotAt(bin.id, ids.b);
    await as((ctx) => clearDamaged(ctx, { productId: ids.b, qty: 1, lotId: lot.id, to: "WRITE_OFF" }));
    expect(await count(ids.b)).toBe(n);
  });

  it("damaged goods back to the company take their loss back", async () => {
    const bin = await as((ctx) => damagedBin(ctx));
    const lot = await lotAt(bin.id, ids.a);
    await as((ctx) => clearDamaged(ctx, { productId: ids.a, qty: 1, lotId: lot.id, to: "SUPPLIER_RETURN", supplierId: ids.supplier }));
    const e = await last(ids.a);
    expect(e.lines).toEqual({ STOCK_LOSS: -10000, PURCHASES: 10000 });
    expect(e.memo).toMatch(/^Damaged goods back to the company/);
  });

  it("a debit note can take the goods from the damaged bin, and their loss comes back out of stock loss", async () => {
    const bin = await as((ctx) => damagedBin(ctx));
    const inBin = async () => (await tenantDb(T).stockLot.findMany({ where: { locationId: bin.id, productId: ids.a } })).reduce((s, l) => s + l.qty, 0);
    const binBefore = await inBin();
    const placeBefore = await placeValue();
    const dn = await as((ctx) =>
      recordPurchase(ctx, { type: "DEBIT_NOTE", supplierId: ids.supplier, date: today, moveStock: true, fromDamaged: true, reason: "Damaged goods back", lines: [{ productId: ids.a, quantity: 2, rate: 10000, gstRate: 18 }] })
    );
    expect(dn.movedStock).toBe(true);
    expect(await inBin()).toBe(binBefore - 2);
    expect(await placeValue()).toBe(placeBefore);
    expect((await last(ids.a)).lines).toEqual({ STOCK_LOSS: -20000, PURCHASES: 20000 });
  });

  it("every posting leaves profit as it was: stock loss and purchases move together", async () => {
    for (const p of [ids.a, ids.b]) {
      for (const e of await entriesFor(p)) {
        expect(Object.keys(e.lines).sort()).toEqual(["PURCHASES", "STOCK_LOSS"]);
        expect(e.lines.STOCK_LOSS + e.lines.PURCHASES).toBe(0);
        expect(e.lines.STOCK_LOSS).toBe(e.value);
      }
    }
  });

  it("the books check ties each entry to its moves", async () => {
    const c = await as((ctx) => checkBooks(ctx));
    const row = c.results.find((x) => x.key === "stock-loss")!;
    expect(row.ok).toBe(true);
  });

  it("without the books module nothing is posted", async () => {
    await setBooks(false);
    try {
      const n = await count(ids.a);
      await as((ctx) => damageStock(ctx, { locationId: ids.place, productId: ids.a, qty: 1, reason: "damaged" }));
      expect(await count(ids.a)).toBe(n);
      const m = await tenantDb(T).stockMove.findFirstOrThrow({ where: { productId: ids.a, kind: "DAMAGE" }, orderBy: { createdAt: "desc" } });
      expect(m.entryId).toBeNull();
    } finally {
      await setBooks(true);
    }
  });
});
