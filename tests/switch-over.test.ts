/**
 * Switch-over (A10) and the books imports (A2.6): suppliers, their open
 * bills and purchase bills from a sheet; the old trial balance matched,
 * checked and used as the opening balances; the parallel run; the checklist.
 *
 * Every database test runs inside one transaction that is rolled back at the
 * end, so the demo tenant is left as it was.
 */
import "dotenv/config";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/db";
import { withMoney, type Ctx } from "@/lib/ledger";
import { createHead, todayIst } from "@/lib/books";
import { openingView } from "@/lib/final-accounts";
import { payablesBySupplier } from "@/lib/supplier-payments";
import { templateCsv, validatePurchases, validateSupplierBills, validateSuppliers, type Row } from "@/lib/importers";
import { importPurchases, importSupplierBills, importSuppliers } from "@/lib/books-import";
import { applyOldTb, checkOldTb, debtorsOn, parallelRun, readOldTb, switchOver } from "@/lib/switch-over";

let T = "";
let adminId = "";
const run = String(Date.now()).slice(-6);
class Rollback extends Error {}

/** Run fn in a transaction and roll it back. */
async function inRollback(fn: (ctx: Ctx) => Promise<void>) {
  await withMoney(T, adminId, async (ctx) => {
    await fn(ctx);
    throw new Rollback("done");
  }).catch((e) => {
    if (!(e instanceof Rollback)) throw e;
  });
}

beforeAll(async () => {
  const demo = await prisma.tenant.findUniqueOrThrow({ where: { slug: "demo" }, select: { id: true } });
  T = demo.id;
  adminId = (await tenantDb(T).user.findFirstOrThrow({ where: { role: "ADMIN" } })).id;
});

const rows = (head: string[], ...data: string[][]): Row[] => data.map((d) => Object.fromEntries(head.map((h, i) => [h, d[i] ?? ""])));

describe("sheet checks", () => {
  it("suppliers: names once, cells only when filled", () => {
    const r = validateSuppliers(rows(["name", "kind", "pan", "credit_days", "state_code"], ["Acme Foods", "goods", "AAACA1234B", "45", "7"], ["acme  foods", "", "", "", ""], ["X", "", "", "", ""]));
    expect(r.valid).toHaveLength(1);
    expect(r.valid[0].fields).toEqual({ kind: "GOODS", pan: "AAACA1234B", creditDays: 45, stateCode: "07" });
    expect(r.errors.map((e) => e.row)).toEqual([3, 4]);
  });

  it("suppliers' open bills: bills, advances, and what is refused", () => {
    const r = validateSupplierBills(
      rows(
        ["supplier", "bill_no", "date", "amount", "paid", "due_date"],
        ["Acme", "A-1", "18/03/2026", "48,250", "10000", "17/04/2026"],
        ["Acme", "", "", "-5000", "", ""],
        ["Acme", "A-2", "18/03/2026", "1000", "1000", ""],
        ["Acme", "A-1", "19/03/2026", "10", "", ""],
        ["Acme", "A-3", "01/01/2999", "10", "", ""],
      ),
      new Date("2026-11-25T06:00:00Z"),
    );
    expect(r.valid.map((v) => [v.number, v.amount, v.paid, v.date, v.dueDate])).toEqual([
      ["A-1", 48_250_00, 10_000_00, "2026-03-18", "2026-04-17"],
      [null, -5_000_00, 0, null, null],
    ]);
    expect(r.errors.map((e) => e.row)).toEqual([4, 5, 6]);
  });

  it("purchase bills: rows grouped by supplier and bill number; a bad row leaves its bill out whole", () => {
    const r = validatePurchases(
      rows(
        ["supplier", "bill_no", "date", "sku", "head", "qty", "rate", "gst_rate", "bill_total", "rates_include_gst"],
        ["Acme", "B-1", "21/11/2026", "SKU1", "", "48", "70.50", "5", "3388", "no"],
        ["acme", "b-1", "21/11/2026", "", "Freight", "1", "200", "", "", ""],
        ["Acme", "B-2", "21/11/2026", "SKU1", "", "0", "10", "", "", ""],
        ["Acme", "B-2", "21/11/2026", "SKU2", "", "2", "10", "", "", ""],
        ["Acme", "B-3", "22/11/2026", "", "", "1", "10", "", "", ""],
      ),
      new Date("2026-11-25T06:00:00Z"),
    );
    expect(r.valid).toHaveLength(1);
    expect(r.valid[0]).toMatchObject({ number: "B-1", date: "2026-11-21", billTotal: 3388_00, ratesIncludeGst: false });
    expect(r.valid[0].lines.map((l) => [l.sku, l.head, l.quantity, l.rate, l.gstRate])).toEqual([
      ["SKU1", null, 48, 70_50, 5],
      [null, "Freight", 1, 200_00, null],
    ]);
    expect(r.errors.map((e) => e.row)).toEqual([4, 5, 6]);
    expect(r.errors[1].message).toMatch(/B-2 has a problem on row 4/);
  });
});

describe("purchase bills: MRP and discounts one after another", () => {
  it("reads mrp and 10+5 discounts, and refuses what doesn't fit", () => {
    const r = validatePurchases(
      rows(
        ["supplier", "bill_no", "date", "sku", "head", "qty", "rate", "mrp", "discount_pct"],
        ["Acme", "M-1", "21/11/2026", "SKU1", "", "10", "100", "120", "10+5"],
        ["Acme", "M-1", "21/11/2026", "SKU2", "", "1", "50", "", " 10 + 5 + 2 "],
        ["Acme", "M-1", "21/11/2026", "", "Freight", "1", "200", "", "2"],
        ["Acme", "M-2", "21/11/2026", "SKU1", "", "1", "10", "", "10+5+2+1"],
        ["Acme", "M-3", "21/11/2026", "SKU1", "", "1", "10", "", "100"],
        ["Acme", "M-4", "21/11/2026", "", "Freight", "1", "10", "20", ""],
        ["Acme", "M-5", "21/11/2026", "SKU1", "", "1", "10", "abc", ""],
      ),
      new Date("2026-11-25T06:00:00Z"),
    );
    expect(r.valid.map((b) => b.number)).toEqual(["M-1"]);
    expect(r.valid[0].lines.map((l) => [l.discountPct, l.discount2Pct, l.discount3Pct, l.mrp])).toEqual([
      [10, 5, 0, 120_00],
      [10, 5, 2, null],
      [2, 0, 0, null],
    ]);
    expect(r.errors.map((e) => e.message)).toEqual([
      expect.stringMatching(/10\+5 for one discount after another/),
      expect.stringMatching(/each under 100/),
      expect.stringMatching(/mrp goes only on a product/),
      expect.stringMatching(/mrp must be a number/),
    ]);
    expect(templateCsv("purchases").split("\r\n")[0]).toContain("rate,mrp,discount_pct");
  });
});

describe("purchase bills: scheme and free-goods deals", () => {
  it("reads scheme_amount and a deal like 10+1, and refuses what doesn't fit", () => {
    const r = validatePurchases(
      rows(
        ["supplier", "bill_no", "date", "sku", "head", "qty", "rate", "scheme_amount", "deal"],
        ["Acme", "S-1", "21/11/2026", "SKU1", "", "25", "10", "12.50", "10+1"],
        ["Acme", "S-1", "21/11/2026", "SKU2", "", "5", "10", "", ""],
        ["Acme", "S-2", "21/11/2026", "SKU1", "", "1", "10", "", "10"],
        ["Acme", "S-3", "21/11/2026", "", "Freight", "1", "10", "5", ""],
        ["Acme", "S-4", "21/11/2026", "SKU1", "", "1", "10", "five", ""],
        ["Acme", "S-5", "21/11/2026", "SKU1", "", "1", "10", "", "0+1"],
      ),
      new Date("2026-11-25T06:00:00Z"),
    );
    expect(r.valid.map((b) => b.number)).toEqual(["S-1"]);
    expect(r.valid[0].lines[0]).toMatchObject({ schemeAmount: 12_50, deal: { buy: 10, get: 1 } });
    expect(r.valid[0].lines[1]).toMatchObject({ schemeAmount: 0 });
    expect(r.valid[0].lines[1].deal).toBeUndefined();
    expect(r.errors.map((e) => e.message)).toEqual([
      expect.stringMatching(/should look like 10\+1/),
      expect.stringMatching(/only on a product/),
      expect.stringMatching(/scheme_amount must be a number/),
      expect.stringMatching(/should look like 10\+1/),
    ]);
    expect(templateCsv("purchases").split("\r\n")[0]).toContain("mrp,discount_pct,scheme_amount,deal,gst_rate");
  });
});

describe("purchase bills by the case", () => {
  const head = ["supplier", "bill_no", "date", "sku", "head", "qty", "rate", "cases", "loose", "case_size", "case_rate"];
  const day = new Date("2026-11-25T06:00:00Z");

  it("are refused while the setting is off, and the template has no case columns", () => {
    const r = validatePurchases(rows(head, ["Acme", "C-1", "21/11/2026", "SKU1", "", "", "", "10", "", "144", "2391.55"]), day);
    expect(r.valid).toHaveLength(0);
    expect(r.errors[0].message).toMatch(/Purchase bill sheets by the case/);
    expect(templateCsv("purchases").split("\r\n")[0]).not.toContain("case_rate");
  });

  it("read cases, loose and the rate per case when it is on", () => {
    const r = validatePurchases(
      rows(
        head,
        ["Acme", "C-1", "21/11/2026", "SKU1", "", "", "", "10", "", "144", "2391.55"],
        ["Acme", "C-1", "21/11/2026", "SKU2", "", "48", "70.50", "", "", "", ""],
        ["Acme", "C-2", "21/11/2026", "", "Freight", "", "", "1", "", "", "100"],
        ["Acme", "C-3", "21/11/2026", "SKU1", "", "1440", "", "10", "1", "144", "2391.55"],
        ["Acme", "C-4", "21/11/2026", "SKU1", "", "", "", "2", "", "", ""],
      ),
      day,
      { purchaseCases: true },
    );
    expect(r.valid.map((b) => b.number)).toEqual(["C-1"]);
    expect(r.valid[0].lines[0]).toMatchObject({ sku: "SKU1", quantity: 0, byCase: { cases: 10, loose: 0, caseSize: 144, caseRate: 2391_55 } });
    expect(r.valid[0].lines[1]).toMatchObject({ quantity: 48, rate: 70_50 });
    expect(r.valid[0].lines[1].byCase).toBeUndefined();
    expect(r.errors.map((e) => e.message)).toEqual([
      expect.stringMatching(/Only a product/),
      expect.stringMatching(/qty 1440 isn't 10 × 144 \+ 1/),
      expect.stringMatching(/case_rate/),
    ]);
    const tpl = templateCsv("purchases", { purchaseCases: true }).split("\r\n");
    expect(tpl[0]).toContain("rate,cases,loose,case_size,case_rate,mrp,discount_pct,scheme_amount,deal");
    expect(tpl[2]).toContain("1680.50");
  });
});

describe("books imports (rolled back)", () => {
  it("adds and updates suppliers, brings in their open bills once, and enters purchase bills", async () => {
    await inRollback(async (ctx) => {
      const name = `Switch test supplier ${run}`;
      const s1 = await importSuppliers(ctx, validateSuppliers(rows(["name", "kind", "pan", "credit_days"], [name, "services", "AAAPS1234C", "20"])).valid);
      expect(s1).toMatchObject({ created: 1, updated: 0, errors: [] });
      const s2 = await importSuppliers(ctx, validateSuppliers(rows(["name", "phone", "pan"], [name.toUpperCase(), "9822012345", "BAD"])).valid);
      expect(s2.errors[0].message).toMatch(/PAN is not valid/);
      const s3 = await importSuppliers(ctx, validateSuppliers(rows(["name", "phone"], [name, "9822012345"])).valid);
      expect(s3).toMatchObject({ created: 0, updated: 1 });
      const sup = await ctx.tx.supplier.findFirstOrThrow({ where: { name } });
      expect(sup).toMatchObject({ kind: "SERVICES", pan: "AAAPS1234C", creditDays: 20, phone: "9822012345" });

      const billRows = rows(["supplier", "bill_no", "date", "amount", "paid"], [name, "OB-1", "10/03/2002", "1000", "200"], [name, "OB-2", "12/03/2002", "500", ""], [name, "", "", "-50", ""]);
      const b1 = await importSupplierBills(ctx, validateSupplierBills(billRows).valid);
      expect(b1).toMatchObject({ created: 3, errors: [] });
      const owed = (await payablesBySupplier(ctx, todayIst(), { supplierId: sup.id })).rows[0].owed;
      expect(owed).toBe(1000_00 - 200_00 + 500_00 - 50_00);
      const b2 = await importSupplierBills(ctx, validateSupplierBills(billRows).valid);
      expect(b2.errors).toHaveLength(3);
      expect(b2.errors[0].message).toMatch(/already has an opening balance/);
      const nobody = await importSupplierBills(ctx, validateSupplierBills(rows(["supplier", "bill_no", "date", "amount"], ["Nobody at all", "X", "01/01/2002", "5"])).valid);
      expect(nobody.errors[0].message).toMatch(/import suppliers first/);

      const product = await ctx.tx.product.findFirstOrThrow({ where: { active: true }, select: { sku: true, gstRate: true } });
      const head = await createHead(ctx, { name: `Switch freight ${run}`, group: "DIRECT_EXPENSES" });
      const pr = rows(
        ["supplier", "bill_no", "date", "sku", "head", "qty", "rate", "discount_pct"],
        [name, "PB-1", "15/06/2002", product.sku, "", "10", "100", "2"],
        [name, "PB-1", "15/06/2002", "", head.name, "1", "150", ""],
        [name, "PB-2", "16/06/2002", "NO-SUCH-SKU", "", "1", "10", ""],
      );
      const p1 = await importPurchases(ctx, validatePurchases(pr).valid);
      expect(p1.created).toBe(1);
      expect(p1.errors.map((e) => e.message)).toEqual([expect.stringMatching(/no product with SKU NO-SUCH-SKU/)]);
      const bill = await ctx.tx.purchaseBill.findFirstOrThrow({ where: { supplierId: sup.id, supplierRef: "PB-1" }, include: { lines: true } });
      expect(bill.lines).toHaveLength(2);
      expect(bill.taxable).toBe(980_00 + 150_00);
      expect(bill.lines.find((l) => l.productId)!.gstRate).toBe(product.gstRate);
      const again = await importPurchases(ctx, validatePurchases(pr.slice(0, 2)).valid);
      expect(again.created).toBe(0);
      expect(again.errors[0].message).toMatch(/already entered/);

      // By the case: the case size comes from the product; the amount is the bill's to the paisa.
      const cased = await ctx.tx.product.update({ where: { id: (await ctx.tx.product.findFirstOrThrow({ where: { sku: product.sku }, select: { id: true } })).id }, data: { caseSize: 144, caseUnit: "case" }, select: { id: true, sku: true } });
      const cr = rows(["supplier", "bill_no", "date", "sku", "cases", "loose", "case_rate", "gst_rate"], [name, "PB-C", "17/06/2002", cased.sku, "10", "0", "2391.55", "18"], [name, "PB-D", "17/06/2002", cased.sku, "1", "", "10", "18"]);
      const nocase = await ctx.tx.product.findFirst({ where: { active: true, caseSize: null }, select: { sku: true } });
      if (nocase) cr.push(...rows(["supplier", "bill_no", "date", "sku", "cases", "case_rate"], [name, "PB-E", "17/06/2002", nocase.sku, "1", "10"]));
      const c1 = await importPurchases(ctx, validatePurchases(cr, new Date(), { purchaseCases: true }).valid);
      expect(c1.created).toBe(2);
      const pears = await ctx.tx.purchaseBill.findFirstOrThrow({ where: { supplierId: sup.id, supplierRef: "PB-C" }, include: { lines: true } });
      expect(pears.lines[0]).toMatchObject({ quantity: 1440, cases: 10, caseSize: 144, caseRate: 2391_55, taxable: 23915_50 });
      if (nocase) expect(c1.errors[0].message).toMatch(/has no case size/);

      // MRP and 10+5: stored on the line, each discount on what is left (100000 → 90000 → 85500).
      const m1 = await importPurchases(ctx, validatePurchases(rows(["supplier", "bill_no", "date", "sku", "qty", "rate", "mrp", "discount_pct", "gst_rate"], [name, "PB-M", "18/06/2002", cased.sku, "100", "10", "12.50", "10+5", "18"])).valid);
      expect(m1).toMatchObject({ created: 1, errors: [] });
      const mb = await ctx.tx.purchaseBill.findFirstOrThrow({ where: { supplierId: sup.id, supplierRef: "PB-M" }, include: { lines: true } });
      expect(mb.lines[0]).toMatchObject({ discountPct: 10, discount2Pct: 5, discount3Pct: 0, mrp: 12_50, taxable: 855_00 });

      // Scheme and deals: 25 billed on 10+1 = 2 free; 10 cases of 144 on 5+1 = 2 cases (288) free; a free_qty that disagrees is refused.
      const dr = rows(
        ["supplier", "bill_no", "date", "sku", "qty", "rate", "free_qty", "scheme_amount", "deal", "cases", "case_rate", "gst_rate"],
        [name, "PB-S", "19/06/2002", cased.sku, "25", "10", "", "20", "10+1", "", "", "18"],
        [name, "PB-T", "19/06/2002", cased.sku, "", "", "", "", "5+1", "10", "2391.55", "18"],
        [name, "PB-U", "19/06/2002", cased.sku, "25", "10", "3", "", "10+1", "", "", "18"],
      );
      const dl = await importPurchases(ctx, validatePurchases(dr, new Date(), { purchaseCases: true }).valid);
      expect(dl.created).toBe(2);
      expect(dl.errors.map((e) => e.message)).toEqual([expect.stringMatching(/free_qty 3 doesn't match deal 10\+1 \(that gives 2\)/)]);
      const sb = await ctx.tx.purchaseBill.findFirstOrThrow({ where: { supplierId: sup.id, supplierRef: "PB-S" }, include: { lines: true } });
      expect(sb.lines[0]).toMatchObject({ quantity: 25, freeQty: 2, schemeAmount: 20_00, taxable: 250_00 - 20_00 });
      const tb = await ctx.tx.purchaseBill.findFirstOrThrow({ where: { supplierId: sup.id, supplierRef: "PB-T" }, include: { lines: true } });
      expect(tb.lines[0]).toMatchObject({ quantity: 1440, freeQty: 288, taxable: 23915_50 });
    });
  }, 30_000);
});

describe("the old trial balance (rolled back)", () => {
  it("matches lines, checks debtors, creditors and stock, and becomes the opening balances", async () => {
    await inRollback(async (ctx) => {
      const v = await openingView(ctx);
      const debtors = v.shops.dues - v.shops.advances;
      const creditors = v.suppliers.owed;
      const bank = v.accounts.find((a) => a.group === "BANK");
      const stock = 5_000_00;
      const cash = 1_234_50;
      const bankAmt = bank ? 10_000_00 : 0;
      const capital = cash + bankAmt + debtors + stock - creditors;
      const sheet = rows(
        ["account", "debit", "credit", "maps_to", "group"],
        ["Cash in hand", (cash / 100).toFixed(2), "", "", ""],
        ...(bank ? [[bank.name, (bankAmt / 100).toFixed(2), "", "", ""]] : []),
        ["Sundry Debtors", debtors >= 0 ? (debtors / 100).toFixed(2) : "", debtors < 0 ? (-debtors / 100).toFixed(2) : "", "", ""],
        ["Sundry Creditors", creditors < 0 ? (-creditors / 100).toFixed(2) : "", creditors >= 0 ? (creditors / 100).toFixed(2) : "", "", ""],
        ["Closing Stock", "5,000.00", "", "", ""],
        [`Capital of the owner ${run}`, capital < 0 ? (-capital / 100).toFixed(2) : "", capital >= 0 ? (capital / 100).toFixed(2) : "", "", "Capital"],
        ["Grand Total", "1", "1", "", ""],
      );
      const read = await readOldTb(ctx, sheet);
      expect(read.errors).toEqual([]);
      expect(read.rows.map((r) => r.target.kind)).toEqual(["ACCOUNT", ...(bank ? ["ACCOUNT"] : []), "DEBTORS", "CREDITORS", "STOCK", "NEW"]);
      const c = checkOldTb(read.rows, read.opening);
      expect(c.checks.filter((x) => !x.ok).map((x) => x.key)).toEqual(v.openingStock === null || v.openingStock === stock ? [] : ["stock"]);
      expect(c.ready).toBe(true);

      // A line that doesn't match anything, with no group, stops it.
      const bad = await readOldTb(ctx, [...sheet, { account: "Mystery suspense", debit: "1", credit: "", maps_to: "", group: "" }]);
      const cb = checkOldTb(bad.rows, bad.opening);
      expect(cb.ready).toBe(false);
      expect(cb.checks.find((x) => x.key === "balanced")!.ok).toBe(false);
      await expect(applyOldTb(ctx, bad.rows, "2002-04-01")).rejects.toThrow(/doesn't balance/);

      const after = await applyOldTb(ctx, read.rows, v.startOn ?? "2002-04-01");
      // A clean business ends at 0. The shared demo tenant carries opening entries other tests left,
      // so the check is that the sheet adds nothing to the gap it already had.
      const otherOpenings = v.difference + v.accounts.reduce((a, x) => a + x.amount, 0) + (v.openingStock ?? 0) + debtors - creditors;
      expect(after.difference).toBe(otherOpenings);
      expect(after.openingStock).toBe(stock);
      expect(after.accounts.find((a) => a.code === "OFFICE_CASH")!.amount).toBe(cash);
      expect(after.accounts.find((a) => a.name === `Capital of the owner ${run}`)!.amount).toBe(-capital);
      const again = checkOldTb((await readOldTb(ctx, sheet)).rows, after);
      expect(again.agrees).toBe(true);
      expect(again.accounts.every((a) => a.old === a.here)).toBe(true);

      const s = await switchOver(ctx);
      expect(s.steps.find((x) => x.key === "tb")!.state).toBe(otherOpenings === 0 ? "done" : "check");
      expect(s.steps.find((x) => x.key === "stock")!.state).toBe("done");
      expect(s.steps.map((x) => x.key)).toEqual(["date", "tb", "banks", "shops", "suppliers", "claims", "stock", "lock", "parallel"]);
    });
  }, 30_000);
});

describe("parallel run (rolled back)", () => {
  it("lines up the old software's figures with ours and shows what differs", async () => {
    await inRollback(async (ctx) => {
      const day = todayIst();
      const all = await debtorsOn(ctx, day);
      const counts = new Map<string, number>();
      for (const d of all) counts.set(d.name.toLowerCase(), (counts.get(d.name.toLowerCase()) ?? 0) + 1);
      const shops = all.filter((d) => counts.get(d.name.toLowerCase()) === 1).slice(0, 2);
      const sup = (await payablesBySupplier(ctx, day)).rows.find((s) => s.owed);
      const cash = (await openingView(ctx)).accounts.length; // the TB is read inside parallelRun; just make sure it runs
      expect(cash).toBeGreaterThan(0);
      const sheet: Row[] = [
        ...shops.map((d, i) => ({ report: "debtors", name: d.name, amount: ((d.dues - d.advance + (i ? 100 : 0)) / 100).toFixed(2) })),
        { report: "debtors", name: `Nobody shop ${run}`, amount: "10" },
        ...(sup ? [{ report: "Sundry Creditors", name: sup.name, amount: (sup.owed / 100).toFixed(2) }] : []),
        { report: "profit", name: "x", amount: "1" },
      ];
      const r = await parallelRun(ctx, day, sheet);
      expect(r.errors.map((e) => e.message)).toEqual([expect.stringMatching(/report must be/)]);
      const d = r.parts.find((p) => p.key === "debtors")!;
      expect(d.sent).toBe(true);
      if (shops[0]) expect(d.lines.find((l) => l.name === shops[0].name)!.diff).toBe(0);
      if (shops[1]) expect(d.lines.find((l) => l.name === shops[1].name)!.diff).toBe(-100);
      expect(d.lines.find((l) => l.name === `Nobody shop ${run}`)).toMatchObject({ here: null, old: 10_00, diff: -10_00 });
      if (sup) expect(r.parts.find((p) => p.key === "creditors")!.lines.find((l) => l.name === sup.name)!.diff).toBe(0);
      expect(r.parts.find((p) => p.key === "tb")!.sent).toBe(false);
      expect(r.agrees).toBe(false);
    });
  }, 30_000);
});
