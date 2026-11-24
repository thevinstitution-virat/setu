/**
 * Stock valuation and physical counts (A6) against the real database:
 * valuation at cost as at the end of any day, a tracked count at one place
 * (blank lines, a batch found while counting, accepting corrects the stock
 * and moves the net shortage at cost to stock shortage), counts with stock
 * tracking off (quantities × rates, value per company), closing stock, the
 * books lock, the exports and the books check.
 *
 * Runs in the demo tenant at a fresh place with fresh products; they are
 * hidden after and the tenant's settings put back.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/db";
import { balanceOf, MoneyError, withMoney, type Ctx } from "@/lib/ledger";
import { checkBooks, dayEnd, dayStart, ensureBooks, todayIst } from "@/lib/books";
import { adjustStock, stockIn } from "@/lib/stock";
import { acceptCount, addCountLine, cancelCount, closingStock, countDetail, countList, fillBlankLines, removeCountLine, saveCountLines, startCount, stockValuation } from "@/lib/stock-counts";
import { countCsv, countSheet, valuationCsv, valuationSheet } from "@/lib/stock-counts-export";
import { renderSheetPdf } from "@/lib/dues-export";
import { can } from "@/lib/permissions";

let T = "";
let adminId = "";
let original: unknown = null;
const run = Date.now().toString().slice(-6);
const today = todayIst();
const yesterday = new Date(Date.now() - 86_400_000 + 5.5 * 3_600_000).toISOString().slice(0, 10);
const as = <R>(fn: (ctx: Ctx) => Promise<R>) => withMoney(T, adminId, fn);
const code = async (p: Promise<unknown>) =>
  p.then(
    () => 0,
    (e) => (e instanceof MoneyError ? e.status : -1),
  );
const msg = async (p: Promise<unknown>) =>
  p.then(
    () => "",
    (e) => (e as Error).message,
  );
const ids = { place: "", place2: "", company: "", cat: "", a: "", b: "", c: "", count: "" };

async function setInventory(enabled: boolean) {
  const t = await prisma.tenant.findUniqueOrThrow({ where: { id: T }, select: { settings: true } });
  const s = (t.settings ?? {}) as Record<string, unknown>;
  await prisma.tenant.update({ where: { id: T }, data: { settings: { ...s, inventory: { enabled, orderCheck: "warn", bufferPct: 10, expiryAlertDays: 7 } } as object } });
}
const lot = (productId: string, batch: string) => tenantDb(T).stockLot.findFirstOrThrow({ where: { locationId: ids.place, productId, batch } });

beforeAll(async () => {
  const demo = await prisma.tenant.findUniqueOrThrow({ where: { slug: "demo" }, select: { id: true, settings: true } });
  T = demo.id;
  original = demo.settings;
  const db = tenantDb(T);
  adminId = (await db.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id;
  await prisma.tenant.update({ where: { id: T }, data: { booksLockedUntil: null } });
  await setInventory(true);
  await as((ctx) => ensureBooks(ctx));
  ids.place = (await db.stockLocation.create({ data: { kind: "WAREHOUSE", name: `Test count godown ${run}` } })).id;
  ids.company = (await db.supplier.create({ data: { name: `Test count company ${run}`, kind: "GOODS" } })).id;
  ids.cat = (await db.category.create({ data: { name: `Test count cat ${run}` } })).id;
  const mk = (sku: string, lastCost: number | null) =>
    db.product.create({
      data: { name: `Test count ${sku} ${run}`, sku: `CNT-${sku}-${run}`, categoryId: ids.cat, supplierId: ids.company, unit: "pc", price: 20000, mrp: 30000, gstRate: 5, lastCost },
    });
  ids.a = (await mk("A", 10000)).id;
  ids.b = (await mk("B", null)).id;
  ids.c = (await mk("C", null)).id;
  const open = (productId: string, delta: number, batch: string, unitCost: number | null) =>
    as((ctx) => adjustStock(ctx, { locationId: ids.place, productId, delta, reason: "opening", batch, unitCost }));
  await open(ids.a, 10, "A1", 10000);
  await open(ids.a, 5, "A2", 12000);
  await open(ids.b, 20, "", null); // no cost of its own; the product gets a last cost below
  await open(ids.c, 3, "", null); // no cost anywhere
  await db.product.update({ where: { id: ids.b }, data: { lastCost: 5000 } });
});

afterAll(async () => {
  if (!T) return;
  await prisma.tenant.update({ where: { id: T }, data: { settings: original as object, booksLockedUntil: null } });
  const db = tenantDb(T);
  await db.product.updateMany({ where: { id: { in: [ids.a, ids.b, ids.c] } }, data: { active: false } });
  await db.supplier.updateMany({ where: { id: ids.company }, data: { active: false } });
  await db.stockLocation.updateMany({ where: { id: { in: [ids.place, ids.place2] } }, data: { active: false } });
});

describe("stock valuation", () => {
  it("values the stock at each batch's cost, else the last cost, and lists what has none", async () => {
    const v = await as((ctx) => stockValuation(ctx, { day: today, by: "company", locationId: ids.place }));
    expect(v.total).toBe(10 * 10000 + 5 * 12000 + 20 * 5000);
    expect(v.units).toBe(38);
    expect(v.atLastCost).toBe(1);
    expect(v.noCost).toBe(1);
    expect(v.groups).toEqual([{ key: ids.company, name: `Test count company ${run}`, qty: 38, value: 260000, products: 3 }]);
    const a = v.rows.find((r) => r.productId === ids.a)!;
    expect([a.qty, a.value]).toEqual([15, 160000]);
  });

  it("works out the stock as at the end of an earlier day from the moves after it", async () => {
    const v = await as((ctx) => stockValuation(ctx, { day: yesterday, by: "place", locationId: ids.place }));
    expect([v.total, v.units, v.rows.length]).toEqual([0, 0, 0]);
    expect(await code(as((ctx) => stockValuation(ctx, { day: "2999-01-01", by: "company" })))).toBe(400);
  });
});

describe("a count against the app's stock", () => {
  it("lets the accountant count, not the sales agent", () => {
    expect(can("ACCOUNTANT", "accounts.post")).toBe(true);
    expect(can("SALES_AGENT", "accounts.post")).toBe(false);
  });

  it("refuses a place that is the damaged bin, a future day and a closed day", async () => {
    expect(await msg(as((ctx) => startCount(ctx, { date: today })))).toBe("Pick the place counted");
    expect(await code(as((ctx) => startCount(ctx, { date: "2999-01-01", locationId: ids.place })))).toBe(400);
    await prisma.tenant.update({ where: { id: T }, data: { booksLockedUntil: new Date(`${today}T00:00:00Z`) } });
    expect(await code(as((ctx) => startCount(ctx, { date: today, locationId: ids.place })))).toBe(409);
    await prisma.tenant.update({ where: { id: T }, data: { booksLockedUntil: null } });
  });

  it("makes a sheet of the batches in stock there, by product", async () => {
    const c = await as((ctx) => startCount(ctx, { date: today, locationId: ids.place, supplierId: ids.company }));
    ids.count = c.id;
    expect(c.number).toMatch(/^SC\d{4}-\d{5}$/);
    const d = await as((ctx) => countDetail(ctx, c.id));
    expect(d.lines.map((l) => [l.name.replace(` ${run}`, ""), l.batch, l.bookQty, l.rate, l.rateFrom])).toEqual([
      ["Test count A", "A1", 10, 10000, "batch"],
      ["Test count A", "A2", 5, 12000, "batch"],
      ["Test count B", "", 20, 5000, "last"],
      ["Test count C", "", 3, null, null],
    ]);
    expect(d.totals.counted).toBe(0);
    expect(d.totals.noRate).toBe(1);
  });

  it("saves counts, refuses a blank line at accepting, and takes batches found while counting", async () => {
    const d = await as((ctx) => countDetail(ctx, ids.count));
    const [a1, a2, b] = d.lines;
    await as((ctx) =>
      saveCountLines(ctx, ids.count, [
        { id: a1.id, countedQty: 8 },
        { id: a2.id, countedQty: 5 },
        { id: b.id, countedQty: 21 },
      ]),
    );
    expect(await msg(as((ctx) => acceptCount(ctx, ids.count)))).toBe("1 line is not counted yet. Count them, or fill the rest first.");
    expect(await code(as((ctx) => saveCountLines(ctx, ids.count, [{ id: a1.id, countedQty: -1 }])))).toBe(400);
    expect(await code(as((ctx) => saveCountLines(ctx, ids.count, [{ id: "nope", countedQty: 1 }])))).toBe(404);
    // A batch the app has none of, found on the shelf.
    const extra = await as((ctx) => addCountLine(ctx, ids.count, { productId: ids.a, batch: "A3", countedQty: 2, rate: 11000 }));
    expect(await code(as((ctx) => addCountLine(ctx, ids.count, { productId: ids.a, batch: "A3" })))).toBe(409);
    expect(await code(as((ctx) => addCountLine(ctx, ids.count, { productId: ids.a, batch: "A1" })))).toBe(409);
    const stray = await as((ctx) => addCountLine(ctx, ids.count, { productId: ids.b, batch: "X9", countedQty: 0 }));
    await as((ctx) => removeCountLine(ctx, ids.count, stray.id));
    expect(await code(as((ctx) => removeCountLine(ctx, ids.count, a1.id)))).toBe(400);
    expect((await as((ctx) => fillBlankLines(ctx, ids.count, "zero"))).filled).toBe(1);
    const after = await as((ctx) => countDetail(ctx, ids.count));
    expect(after.lines.find((l) => l.id === extra.id)?.bookQty).toBe(0);
    // Short: A1 2 × ₹100, C 3 × ₹0. Over: B 1 × ₹50, A3 2 × ₹110.
    expect([after.totals.shortage, after.totals.excess, after.totals.short, after.totals.over]).toEqual([20000, 27000, 2, 2]);
  });

  it("accepting corrects the stock to the count and posts the net at cost to stock shortage", async () => {
    const loss0 = await as((ctx) => balanceOf(ctx, { type: "STOCK_LOSS" }));
    const buy0 = await as((ctx) => balanceOf(ctx, { type: "PURCHASES" }));
    await as((ctx) => acceptCount(ctx, ids.count));
    expect([(await lot(ids.a, "A1")).qty, (await lot(ids.a, "A2")).qty, (await lot(ids.a, "A3")).qty, (await lot(ids.b, "")).qty, (await lot(ids.c, "")).qty]).toEqual([8, 5, 2, 21, 0]);
    expect((await lot(ids.a, "A3")).unitCost).toBe(11000);
    // Net excess ₹70: Dr Purchases, Cr Stock shortage.
    expect((await as((ctx) => balanceOf(ctx, { type: "STOCK_LOSS" }))) - loss0).toBe(-7000);
    expect((await as((ctx) => balanceOf(ctx, { type: "PURCHASES" }))) - buy0).toBe(7000);
    const c = await tenantDb(T).stockCount.findUniqueOrThrow({ where: { id: ids.count } });
    expect([c.status, Number(c.bookValue), Number(c.countedValue), Number(c.shortage), Number(c.excess), !!c.entryId]).toEqual(["ACCEPTED", 260000, 267000, 20000, 27000, true]);
    const moves = await tenantDb(T).stockMove.findMany({ where: { docId: ids.count } });
    expect(moves.every((m) => m.kind === "ADJUST" && m.reason === "count")).toBe(true);
    expect(moves.length).toBe(4);
  });

  it("an accepted count is final: no changes, no cancel, and no older count after it", async () => {
    expect(await code(as((ctx) => saveCountLines(ctx, ids.count, [{ id: "x", countedQty: 1 }])))).toBe(409);
    expect(await code(as((ctx) => acceptCount(ctx, ids.count)))).toBe(409);
    expect(await code(as((ctx) => cancelCount(ctx, ids.count, "Wrong count")))).toBe(409);
    const old = await as((ctx) => startCount(ctx, { date: yesterday, locationId: ids.place }));
    expect((await as((ctx) => countDetail(ctx, old.id))).lines.length).toBe(0);
    expect(await code(as((ctx) => acceptCount(ctx, old.id)))).toBe(409);
    expect(await code(as((ctx) => cancelCount(ctx, old.id, "x")))).toBe(400);
    await as((ctx) => cancelCount(ctx, old.id, "Started by mistake"));
    const list = await as((ctx) => countList(ctx));
    expect(list.find((x) => x.id === ids.count)).toMatchObject({ status: "ACCEPTED", lines: 5, counted: 5, countedValue: 267000 });
    expect(list.find((x) => x.id === old.id)?.status).toBe("CANCELLED");
  });

  it("a count of an earlier day corrects the stock as at the end of that day", async () => {
    ids.place2 = (await tenantDb(T).stockLocation.create({ data: { kind: "WAREHOUSE", name: `Test count godown 2 ${run}` } })).id;
    // 10 came in yesterday; 3 went out today.
    await as((ctx) =>
      stockIn(ctx, { kind: "OPENING", locationId: ids.place2, productId: ids.a, qty: 10, lot: { batch: "Y1", unitCost: 10000 }, at: new Date(dayStart(yesterday).getTime() + 12 * 3_600_000) }),
    );
    await as((ctx) => adjustStock(ctx, { locationId: ids.place2, productId: ids.a, delta: -3, reason: "lost" }));
    const value = async (day: string) => (await as((ctx) => stockValuation(ctx, { day, by: "place", locationId: ids.place2 }))).units;
    expect([await value(yesterday), await value(today)]).toEqual([10, 7]);
    const c = await as((ctx) => startCount(ctx, { date: yesterday, locationId: ids.place2 }));
    const [line] = (await as((ctx) => countDetail(ctx, c.id))).lines;
    expect(line.bookQty).toBe(10);
    await as((ctx) => saveCountLines(ctx, c.id, [{ id: line.id, countedQty: 9 }]));
    const loss0 = await as((ctx) => balanceOf(ctx, { type: "STOCK_LOSS" }));
    await as((ctx) => acceptCount(ctx, c.id));
    expect([await value(yesterday), await value(today)]).toEqual([9, 6]);
    expect((await as((ctx) => balanceOf(ctx, { type: "STOCK_LOSS" }))) - loss0).toBe(10000);
    const done = await tenantDb(T).stockCount.findUniqueOrThrow({ where: { id: c.id } });
    const entry = await tenantDb(T).journalEntry.findUniqueOrThrow({ where: { id: done.entryId! } });
    expect(entry.occurredAt.getTime()).toBe(dayEnd(yesterday).getTime());
  });

  it("closing stock with tracking on is the app's stock at cost, noting the last count", async () => {
    const cs = await as((ctx) => closingStock(ctx, today));
    const all = await as((ctx) => stockValuation(ctx, { day: today, by: "company" }));
    expect(cs.source).toBe("book");
    expect(cs.value).toBe(all.total);
    expect(cs.lastCount?.id).toBe(ids.count);
    expect(cs.warning).toBeNull();
    const v = await as((ctx) => stockValuation(ctx, { day: today, by: "company", locationId: ids.place }));
    expect(v.total).toBe(267000);
  });
});

describe("counts with stock tracking off", () => {
  let qty = "";
  let val = "";
  it("quantities × rates: every product, blanks as 0, a rate needed where there is no cost", async () => {
    await setInventory(false);
    const c = await as((ctx) => startCount(ctx, { date: today, mode: "QUANTITY" }));
    qty = c.id;
    expect(c.mode).toBe("QUANTITY");
    const d = await as((ctx) => countDetail(ctx, c.id));
    const la = d.lines.find((l) => l.productId === ids.a)!;
    const lc = d.lines.find((l) => l.productId === ids.c)!;
    await as((ctx) =>
      saveCountLines(ctx, c.id, [
        { id: la.id, countedQty: 4 },
        { id: lc.id, countedQty: 1 },
      ]),
    );
    expect(await code(as((ctx) => addCountLine(ctx, c.id, { productId: ids.a })))).toBe(409);
    await as((ctx) => fillBlankLines(ctx, c.id, "book"));
    expect(await msg(as((ctx) => acceptCount(ctx, c.id)))).toBe(`Enter the rate for Test count C ${run}`);
    await as((ctx) => saveCountLines(ctx, c.id, [{ id: lc.id, rate: 2500 }]));
    await as((ctx) => acceptCount(ctx, c.id));
    const done = await as((ctx) => countDetail(ctx, c.id));
    expect(done.totals.countedValue).toBe(4 * 10000 + 2500 + done.lines.filter((l) => l.productId !== ids.a && l.productId !== ids.c).reduce((a, l) => a + (l.countedValue ?? 0), 0));
    const cs = await as((ctx) => closingStock(ctx, today));
    expect([cs.source, cs.value, cs.lastCount?.id]).toEqual(["count", done.totals.countedValue, c.id]);
  });

  it("value per company: the total is the closing stock, and it can be cancelled", async () => {
    const c = await as((ctx) => startCount(ctx, { date: today, mode: "VALUE" }));
    val = c.id;
    const d = await as((ctx) => countDetail(ctx, c.id));
    const mine = d.lines.find((l) => l.supplierId === ids.company)!;
    expect(d.lines.at(-1)?.name).toBe("Other goods");
    await as((ctx) => saveCountLines(ctx, c.id, [{ id: mine.id, value: 5_00_000_00 }]));
    expect(await code(as((ctx) => addCountLine(ctx, c.id, { productId: ids.a })))).toBe(400);
    await as((ctx) => fillBlankLines(ctx, c.id, "zero"));
    await as((ctx) => acceptCount(ctx, c.id));
    expect((await as((ctx) => closingStock(ctx, today))).value).toBe(5_00_000_00);
    await as((ctx) => cancelCount(ctx, c.id, "Entered the wrong figure"));
    expect((await as((ctx) => closingStock(ctx, today))).lastCount?.id).toBe(qty);
    await as((ctx) => cancelCount(ctx, qty, "Test over"));
    await setInventory(true);
  });

  it("downloads the valuation, the count sheet and the result", async () => {
    const tenant = { name: "Test", address: null, gstin: null };
    const v = await as((ctx) => stockValuation(ctx, { day: today, by: "company", locationId: ids.place }));
    const done = await as((ctx) => countDetail(ctx, ids.count));
    const blank = await as((ctx) => startCount(ctx, { date: today, locationId: ids.place }));
    const sheet = await as((ctx) => countDetail(ctx, blank.id));
    const values = await as((ctx) => countDetail(ctx, val));
    for (const s of [valuationSheet(v), countSheet(done), countSheet(sheet), countSheet(values)]) expect((await renderSheetPdf(s, tenant)).byteLength).toBeGreaterThan(1000);
    expect(countSheet(sheet).cols.map((c) => c.label)).not.toContain("In the app");
    expect(valuationCsv(v).at(-1)?.[7]).toBe("2670.00");
    expect(countCsv(done)[0][7]).toBe("In the app");
    await as((ctx) => cancelCount(ctx, blank.id, "Test over"));
  });

  it("keeps the books clean: stock counts agree with the ledger", async () => {
    const r = await as((ctx) => checkBooks(ctx));
    expect(r.results.filter((x) => !x.ok)).toEqual([]);
    expect(r.results.find((x) => x.key === "stock-counts")?.ok).toBe(true);
  });
});
