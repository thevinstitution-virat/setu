/**
 * Purchases (A2) against the real database: suppliers as creditors, purchase
 * bills with goods and head lines, GST input (claimable or not), reverse
 * charge, other-state suppliers, round-off, debit and credit notes set
 * against bills, cancelling, bills made from goods received, bills that bring
 * goods in, opening bills, the supplier summary, the purchase register and
 * the books check.
 *
 * Runs in the demo tenant with fresh suppliers and products; stock settings
 * are put back after and the test suppliers are hidden.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/db";
import { balanceOf, MoneyError, withMoney, type Ctx } from "@/lib/ledger";
import { checkBooks, ensureBooks, todayIst } from "@/lib/books";
import {
  cancelPurchase,
  openingSupplierBills,
  purchaseDetail,
  purchaseLineMoney,
  purchaseOptions,
  purchaseRegister,
  recordPurchase,
  supplierDetail,
  supplierSummary,
  type PurchaseInput,
} from "@/lib/purchases";
import { defaultWarehouse, receiveGoods } from "@/lib/stock";
import { parseSupplier } from "@/lib/supplier-api";
import { can } from "@/lib/permissions";
import { purchaseRegisterCsv, purchaseRegisterSheet } from "@/lib/books-export";
import { renderSheetPdf } from "@/lib/dues-export";

let T = "";
let adminId = "";
let tenantState = "";
let originalSettings: unknown = null;
const run = Date.now().toString().slice(-6);
const today = todayIst();
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000 + 5.5 * 3_600_000).toISOString().slice(0, 10);
const as = <R>(fn: (ctx: Ctx) => Promise<R>) => withMoney(T, adminId, fn);
const code = async (p: Promise<unknown>) => p.then(() => 0, (e) => (e instanceof MoneyError ? e.status : -1));
const ids = { local: "", far: "", transport: "", headFreight: "", headRepairs: "", cat: "", p1: "", p2: "" };
const owed = async (supplierId: string) => -(await as((ctx) => balanceOf(ctx, { type: "PAYABLE", supplierId })));
const entryLines = async (entryId: string) => {
  const lines = await tenantDb(T).ledgerLine.findMany({ where: { entryId }, include: { account: true } });
  return Object.fromEntries(lines.map((l) => [l.account.code, l.amount]));
};
const bill = (over: Partial<PurchaseInput> = {}): PurchaseInput => ({
  supplierId: ids.local,
  supplierRef: `INV-${run}-${Math.random().toString(36).slice(2, 7)}`,
  date: daysAgo(2),
  lines: [{ productId: ids.p1, quantity: 10, rate: 10000, gstRate: 18 }],
  ...over,
});

beforeAll(async () => {
  const demo = await prisma.tenant.findUniqueOrThrow({ where: { slug: "demo" }, select: { id: true, settings: true, stateCode: true } });
  T = demo.id;
  originalSettings = demo.settings;
  tenantState = demo.stateCode ?? "27";
  const db = tenantDb(T);
  adminId = (await db.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id;
  await prisma.tenant.update({ where: { id: T }, data: { booksLockedUntil: null } });
  await as((ctx) => ensureBooks(ctx));
  const farState = tenantState === "29" ? "27" : "29";
  ids.local = (await db.supplier.create({ data: { name: `Test purchases local ${run}`, stateCode: tenantState, creditDays: 15 } })).id;
  ids.far = (await db.supplier.create({ data: { name: `Test purchases far ${run}`, stateCode: farState } })).id;
  ids.transport = (await db.supplier.create({ data: { name: `Test transport ${run}`, kind: "SERVICES", stateCode: tenantState } })).id;
  const heads = await db.ledgerHead.findMany({ where: { active: true, group: { in: ["DIRECT_EXPENSES", "INDIRECT_EXPENSES"] } } });
  ids.headFreight = heads.find((h) => /freight|carriage|transport/i.test(h.name))?.id ?? heads[0].id;
  ids.headRepairs = heads.find((h) => h.id !== ids.headFreight)!.id;
  ids.cat = (await db.category.create({ data: { name: `Purchases cat ${run}` } })).id;
  const mk = (sku: string) => db.product.create({ data: { name: `Test purchase ${sku} ${run}`, sku: `PUR-${sku}-${run}`, categoryId: ids.cat, unit: "pc", price: 15000, mrp: 20000, gstRate: 18, hsnCode: "3401", supplierId: ids.local } });
  ids.p1 = (await mk("A")).id;
  ids.p2 = (await mk("B")).id;
});

afterAll(async () => {
  await prisma.tenant.update({ where: { id: T }, data: { settings: originalSettings as object, booksLockedUntil: null } });
  const db = tenantDb(T);
  await db.supplier.updateMany({ where: { id: { in: [ids.local, ids.far, ids.transport] } }, data: { active: false } });
  await db.product.updateMany({ where: { id: { in: [ids.p1, ids.p2] } }, data: { active: false } });
});

const stockOnFor = async (on: boolean) => {
  const t = await prisma.tenant.findUniqueOrThrow({ where: { id: T }, select: { settings: true } });
  const s = (t.settings ?? {}) as Record<string, unknown>;
  await prisma.tenant.update({ where: { id: T }, data: { settings: { ...s, inventory: { ...((s.inventory as object) ?? {}), enabled: on } } as object } });
};

describe("line maths", () => {
  it("takes discount off before GST, and takes GST out when rates include it", () => {
    expect(purchaseLineMoney(10000, 10, 10, 18, false, false)).toMatchObject({ gross: 100000, discount: 10000, taxable: 90000, tax: 16200, cgst: 8100, sgst: 8100, igst: 0, total: 106200 });
    expect(purchaseLineMoney(11800, 1, 0, 18, true, false)).toMatchObject({ taxable: 10000, tax: 1800, total: 11800 });
    expect(purchaseLineMoney(10000, 1, 0, 12, false, true)).toMatchObject({ igst: 1200, cgst: 0, sgst: 0 });
  });
});

describe("suppliers", () => {
  it("reads the state and PAN from the GSTIN and checks bank details", () => {
    const d = parseSupplier({ name: "Acme Traders", gstin: "27AAPFU0939F1ZV", kind: "SERVICES", creditDays: 45 }, false);
    expect(d).toMatchObject({ stateCode: "27", pan: "AAPFU0939F", kind: "SERVICES", creditDays: 45 });
    expect(parseSupplier({ name: "Acme", bankIfsc: "SBIN123" }, false)).toMatch(/IFSC/);
    expect(parseSupplier({ name: "Acme", kind: "SHOP" }, false)).toMatch(/Pick/);
    expect(parseSupplier({ name: "Acme", gstin: "27AAPFU0939F1ZV", stateCode: "29" }, false)).toMatch(/match/);
    expect(parseSupplier({ name: "Acme", tdsSection: "194c" }, false)).toMatchObject({ tdsSection: "194C" });
  });

  it("lets the accountant enter purchases but not the sales agent", () => {
    expect(can("ACCOUNTANT", ["purchases.manage", "accounts.view"])).toBe(true);
    expect(can("SALES_AGENT", "purchases.manage")).toBe(false);
  });
});

describe("purchase bill", () => {
  it("posts goods, a head, claimable GST and the supplier, with round-off and a due date", async () => {
    const doc = await as((ctx) =>
      recordPurchase(ctx, bill({ lines: [{ productId: ids.p1, quantity: 10, rate: 10050, gstRate: 18 }, { target: "HEAD", headId: ids.headFreight, quantity: 1, rate: 50000, gstRate: 5 }] }))
    );
    // goods 100500 + 18090 tax; freight 50000 + 2500 tax = 171090 → 171100 rounded
    expect(doc).toMatchObject({ taxable: 150500, itcTax: 20590, roundOff: 10, total: 171100, interState: false });
    expect(doc.cgst + doc.sgst).toBe(20590);
    const l = await entryLines(doc.entryId!);
    expect(l.PURCHASES).toBe(100500);
    expect(l[`HEAD:${ids.headFreight}`]).toBe(50000);
    expect(l.GST_INPUT).toBe(20590);
    expect(l.ROUND_OFF).toBe(10);
    expect(l[`PAYABLE:${ids.local}`]).toBe(-171100);
    const sb = await tenantDb(T).supplierBill.findUniqueOrThrow({ where: { purchaseBillId: doc.id } });
    expect(sb).toMatchObject({ amount: 171100, paid: 0, settled: false, kind: "PURCHASE" });
    const due = new Date(`${daysAgo(2)}T00:00:00Z`);
    due.setUTCDate(due.getUTCDate() + 15);
    expect(sb.dueDate.toISOString().slice(0, 10)).toBe(due.toISOString().slice(0, 10));
    expect(doc.number).toMatch(/^PB\d{4}-\d{5}$/);
  });

  it("refuses the same supplier bill number twice, a future date and a wrong total", async () => {
    const ref = `DUP-${run}`;
    await as((ctx) => recordPurchase(ctx, bill({ supplierRef: ref })));
    expect(await code(as((ctx) => recordPurchase(ctx, bill({ supplierRef: ref }))))).toBe(409);
    expect(await code(as((ctx) => recordPurchase(ctx, bill({ date: "2999-01-01" }))))).toBe(400);
    expect(await code(as((ctx) => recordPurchase(ctx, bill({ billTotal: 100000 }))))).toBe(400);
    expect(await code(as((ctx) => recordPurchase(ctx, bill({ lines: [{ productId: ids.p1, quantity: 1, rate: 100, gstRate: 17 }] }))))).toBe(400);
    expect(await code(as((ctx) => recordPurchase(ctx, bill({ lines: [{ target: "CLAIM", quantity: 1, rate: 100 }] }))))).toBe(400);
  });

  it("uses the printed total when it is within a rupee", async () => {
    const doc = await as((ctx) => recordPurchase(ctx, bill({ billTotal: 118050 })));
    expect(doc).toMatchObject({ total: 118050, roundOff: 50 });
  });

  it("puts tax we can't claim into the cost", async () => {
    const doc = await as((ctx) => recordPurchase(ctx, bill({ supplierId: ids.transport, lines: [{ target: "HEAD", headId: ids.headRepairs, quantity: 1, rate: 100000, gstRate: 18, itc: false }] })));
    expect(doc.itcTax).toBe(0);
    const l = await entryLines(doc.entryId!);
    expect(l[`HEAD:${ids.headRepairs}`]).toBe(118000);
    expect(l.GST_INPUT).toBeUndefined();
  });

  it("charges IGST for another state's supplier", async () => {
    const doc = await as((ctx) => recordPurchase(ctx, bill({ supplierId: ids.far })));
    expect(doc).toMatchObject({ interState: true, igst: 18000, cgst: 0, sgst: 0 });
  });

  it("owes the supplier only the value under reverse charge, and the tax to the government", async () => {
    const before = await owed(ids.transport);
    const doc = await as((ctx) => recordPurchase(ctx, bill({ supplierId: ids.transport, reverseCharge: true, lines: [{ target: "HEAD", headId: ids.headFreight, quantity: 1, rate: 200000, gstRate: 5 }] })));
    expect(doc.total).toBe(200000);
    const l = await entryLines(doc.entryId!);
    expect(l.GST_INPUT).toBe(10000);
    expect(l.GST_OUTPUT).toBe(-10000);
    expect((await owed(ids.transport)) - before).toBe(200000);
  });
});

describe("notes", () => {
  it("sets a debit note against its bill, and a scheme credit note against the oldest", async () => {
    const s = (await as((ctx) => ctx.tx.supplier.create({ data: { name: `Test notes ${run}`, stateCode: tenantState } }))).id;
    const b1 = await as((ctx) => recordPurchase(ctx, bill({ supplierId: s, date: daysAgo(10) })));
    const b2 = await as((ctx) => recordPurchase(ctx, bill({ supplierId: s, date: daysAgo(5) })));
    const dn = await as((ctx) => recordPurchase(ctx, { type: "DEBIT_NOTE", supplierId: s, date: daysAgo(1), againstId: b2.id, reason: "Damaged in transit", lines: [{ productId: ids.p1, quantity: 2, rate: 10000, gstRate: 18 }] }));
    expect(dn.supplierRef).toBe(dn.number);
    let l = await entryLines(dn.entryId!);
    expect(l.PURCHASE_RETURNS).toBe(-20000);
    expect(l.GST_INPUT).toBe(-3600);
    expect(l[`PAYABLE:${s}`]).toBe(23600);
    const sb2 = await tenantDb(T).supplierBill.findUniqueOrThrow({ where: { purchaseBillId: b2.id } });
    expect(sb2.paid).toBe(23600);

    const cn = await as((ctx) => recordPurchase(ctx, { type: "CREDIT_NOTE", supplierId: s, supplierRef: `CN-${run}`, date: today, reason: "Diwali scheme", lines: [{ target: "CLAIM", quantity: 1, rate: 5000, gstRate: 0 }] }));
    l = await entryLines(cn.entryId!);
    expect(l.CLAIM_INCOME).toBe(-5000);
    const sb1 = await tenantDb(T).supplierBill.findUniqueOrThrow({ where: { purchaseBillId: b1.id } });
    expect(sb1.paid).toBe(5000);
    expect(await owed(s)).toBe(118000 * 2 - 23600 - 5000);

    // A note can't be against another supplier's bill.
    const other = await as((ctx) => recordPurchase(ctx, bill()));
    expect(await code(as((ctx) => recordPurchase(ctx, { type: "DEBIT_NOTE", supplierId: s, date: today, againstId: other.id, lines: [{ productId: ids.p1, quantity: 1, rate: 100, gstRate: 0 }] })))).toBe(400);

    // Cancelling: the bill waits for its notes; then everything is put back.
    expect(await code(as((ctx) => cancelPurchase(ctx, b2.id, "Entered twice")))).toBe(409);
    await as((ctx) => cancelPurchase(ctx, dn.id, "Wrong quantity"));
    await as((ctx) => cancelPurchase(ctx, b2.id, "Entered twice"));
    expect(await code(as((ctx) => cancelPurchase(ctx, b2.id, "Again")))).toBe(409);
    expect(await owed(s)).toBe(118000 - 5000);
    // Its number is free again for the real bill.
    await as((ctx) => recordPurchase(ctx, bill({ supplierId: s, supplierRef: b2.supplierRef })));
    const d = await as((ctx) => supplierDetail(ctx, s));
    expect(d.summary.owed).toBe(118000 * 2 - 5000);
    expect(d.bills).toHaveLength(2);
    await as((ctx) => ctx.tx.supplier.update({ where: { id: s }, data: { active: false } }));
  });
});

describe("stock", () => {
  it("bills goods received and corrects their cost; each receipt is billed once", async () => {
    await stockOnFor(true);
    const grn = await as((ctx) => receiveGoods(ctx, { supplierId: ids.local, lines: [{ productId: ids.p2, quantity: 12, unitCost: 9000 }] }));
    const opts = await as((ctx) => purchaseOptions(ctx));
    expect(opts.grns.some((g) => g.id === grn.id)).toBe(true);
    const gl = grn.lines[0];
    // 10 billed + 2 free at ₹100 less 5%: taxable 95000 → cost 95000 / 12 = 7917
    const doc = await as((ctx) => recordPurchase(ctx, bill({ purchaseId: grn.id, lines: [{ productId: ids.p2, quantity: 10, freeQty: 2, rate: 10000, discountPct: 5, gstRate: 18, purchaseLineId: gl.id }] })));
    expect(doc.purchaseId).toBe(grn.id);
    const lot = await tenantDb(T).stockLot.findUniqueOrThrow({ where: { id: gl.lotId! } });
    expect(lot.unitCost).toBe(7917);
    expect((await tenantDb(T).product.findUniqueOrThrow({ where: { id: ids.p2 } })).lastCost).toBe(7917);
    expect(await code(as((ctx) => recordPurchase(ctx, bill({ purchaseId: grn.id }))))).toBe(409);
  });

  it("brings goods in with the bill, and sends them back with a debit note", async () => {
    await stockOnFor(true);
    const wh = await as((ctx) => defaultWarehouse(ctx));
    const qty = async () => (await tenantDb(T).stockLot.findMany({ where: { productId: ids.p1, locationId: wh.id } })).reduce((a, l) => a + l.qty, 0);
    const start = await qty();
    const doc = await as((ctx) => recordPurchase(ctx, bill({ moveStock: true, lines: [{ productId: ids.p1, quantity: 20, freeQty: 4, rate: 12000, gstRate: 18 }] })));
    expect(doc.movedStock).toBe(true);
    expect(await qty()).toBe(start + 24);
    expect(doc.lines[0].purchaseLineId).not.toBeNull();
    expect(await code(as((ctx) => cancelPurchase(ctx, doc.id, "Mistake")))).toBe(409);
    await as((ctx) => recordPurchase(ctx, { type: "DEBIT_NOTE", supplierId: ids.local, date: today, againstId: doc.id, moveStock: true, lines: [{ productId: ids.p1, quantity: 3, rate: 12000, gstRate: 18 }] }));
    expect(await qty()).toBe(start + 21);
  });

  it("refuses to move goods when stock tracking is off", async () => {
    await stockOnFor(false);
    expect(await code(as((ctx) => recordPurchase(ctx, bill({ moveStock: true }))))).toBe(400);
    await stockOnFor(true);
  });
});

describe("opening bills", () => {
  it("enters what we owed bill by bill, with an advance, once", async () => {
    const s = (await as((ctx) => ctx.tx.supplier.create({ data: { name: `Test opening ${run}`, stateCode: tenantState } }))).id;
    const r = await as((ctx) =>
      openingSupplierBills(ctx, s, [
        { number: "OLD-1", date: "2026-03-10", amount: 500000, paid: 100000 },
        { number: "OLD-2", date: "2026-03-20", amount: 200000 },
      ], 50000, daysAgo(30))
    );
    expect(r).toMatchObject({ bills: 2, dues: 600000, advance: 50000 });
    expect(await owed(s)).toBe(550000);
    const bills = await tenantDb(T).supplierBill.findMany({ where: { supplierId: s }, orderBy: { date: "asc" } });
    expect(bills.map((b) => b.paid)).toEqual([150000, 0]);
    expect(await code(as((ctx) => openingSupplierBills(ctx, s, [{ number: "OLD-3", date: "2026-03-01", amount: 100 }])))).toBe(409);
    expect(await code(as((ctx) => openingSupplierBills(ctx, ids.far, [{ number: "X", date: "2026-03-01", amount: 100, paid: 100 }])))).toBe(400);
    await as((ctx) => ctx.tx.supplier.update({ where: { id: s }, data: { active: false } }));
  });
});

describe("reports and checks", () => {
  it("shows what we owe each supplier and the purchase register with notes minus", async () => {
    const rows = await as((ctx) => supplierSummary(ctx));
    const local = rows.find((r) => r.id === ids.local)!;
    expect(local.owed).toBe(await owed(ids.local));
    expect(local.openBills).toBeGreaterThan(0);
    const reg = await as((ctx) => purchaseRegister(ctx, daysAgo(40), today));
    const mine = reg.docs.filter((d) => [ids.local, ids.far, ids.transport].includes(d.supplierId) && !d.cancelled);
    expect(mine.length).toBeGreaterThan(5);
    const sum = reg.docs.filter((d) => !d.cancelled).reduce((a, d) => a + (d.type === "BILL" ? d.total : -d.total), 0);
    expect(reg.totals.total).toBe(sum);
    expect(reg.rates.find((x) => x.rate === 18)).toBeDefined();
    const pdf = await renderSheetPdf(purchaseRegisterSheet(reg), { name: "Test", address: null, gstin: null });
    expect(pdf.byteLength).toBeGreaterThan(1000);
    expect(purchaseRegisterCsv(reg)[0]).toContain("Supplier bill no");
    const one = await as((ctx) => purchaseDetail(ctx, mine[0].id));
    expect(one.lines.length).toBeGreaterThan(0);
  });

  it("keeps the books clean", async () => {
    const c = await as((ctx) => checkBooks(ctx));
    const bad = c.results.filter((r) => !r.ok).map((r) => `${r.key}: ${r.detail}`);
    expect(bad).toEqual([]);
  });
});
