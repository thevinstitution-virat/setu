/**
 * Sales bill import: the sheet checks (grouping, discounts, scheme, deals,
 * the shop), then bills written as sale invoices with their own numbers,
 * booked as sales with a bill each, our running series moved past them, and
 * what gets refused. The database part runs in one transaction that is
 * rolled back, so the demo tenant is left as it was.
 */
import "dotenv/config";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/db";
import { withMoney, type Ctx } from "@/lib/ledger";
import { nextRunningNumber } from "@/lib/invoice";
import { INVOICE_DEFAULTS } from "@/lib/invoice-settings";
import { templateCsv, validateSales, type Row } from "@/lib/importers";
import { importSales, saleLineMoney } from "@/lib/sales-import";

let T = "";
let adminId = "";
const run = String(Date.now()).slice(-6);
class Rollback extends Error {}

async function inRollback(fn: (ctx: Ctx) => Promise<void>) {
  await withMoney(T, adminId, async (ctx) => {
    await fn(ctx);
    throw new Rollback("done");
  }).catch((e) => {
    if (!(e instanceof Rollback)) throw e;
  });
}

const rows = (head: string[], ...data: string[][]): Row[] => data.map((d) => Object.fromEntries(head.map((h, i) => [h, d[i] ?? ""])));
const HEAD = ["party", "area", "phone", "invoice_no", "date", "salesman", "sku", "qty", "free_qty", "rate", "discount_pct", "scheme_amount", "deal", "gst_rate", "rates_include_gst", "bill_total"];

beforeAll(async () => {
  const demo = await prisma.tenant.findUniqueOrThrow({ where: { slug: "demo" }, select: { id: true } });
  T = demo.id;
  adminId = (await tenantDb(T).user.findFirstOrThrow({ where: { role: "ADMIN" } })).id;
});

describe("sales bill sheet", () => {
  it("groups rows by invoice_no, reads 10+5, scheme and deals, and leaves a bad bill out whole", () => {
    const r = validateSales(
      rows(
        HEAD,
        ["Shop A", "", "", "s-1", "21/11/2026", "", "SKU1", "48", "", "95", "10+5", "25", "24+1", "5", "yes", ""],
        ["Shop A", "", "", "S-1", "21/11/2026", "", "SKU2", "10", "", "50", "", "", "", "", "yes", ""],
        ["Shop B", "", "", "S-2", "21/11/2026", "", "SKU1", "10", "3", "95", "", "", "10+1", "", "", ""],
        ["Shop B", "", "", "S-3", "21/11/2026", "", "SKU1", "10", "", "95", "", "", "", "", "", ""],
        ["Shop C", "", "", "S-3", "22/11/2026", "", "SKU1", "10", "", "95", "", "", "", "", "", ""],
        ["", "", "", "S-4", "21/11/2026", "", "SKU1", "10", "", "95", "", "", "", "", "", ""],
        ["Shop D", "", "", "S 5", "21/11/2026", "", "SKU1", "10", "", "95", "", "", "", "", "", ""],
        ["Shop D", "", "", "S-6", "21/11/2026", "", "SKU1", "10", "", "95", "", "x", "", "", "", ""],
      ),
      new Date("2026-11-25T06:00:00Z"),
      { ratesIncludeGst: false },
    );
    expect(r.valid.map((b) => b.number)).toEqual(["S-1"]);
    expect(r.valid[0]).toMatchObject({ party: "Shop A", date: "2026-11-21", ratesIncludeGst: true });
    expect(r.valid[0].lines[0]).toMatchObject({ quantity: 48, freeQty: 2, rate: 9500, discountPct: 10, discount2Pct: 5, schemeAmount: 2500, gstRate: 5, deal: { buy: 24, get: 1 } });
    expect(r.valid[0].lines[1]).toMatchObject({ quantity: 10, freeQty: 0, gstRate: null });
    expect(r.errors.map((e) => [e.row, e.message])).toEqual([
      [4, expect.stringMatching(/free_qty 3 doesn't match deal 10\+1 \(that gives 1\)/)],
      [6, expect.stringMatching(/Bill S-3 has another date on row 5/)],
      [5, expect.stringMatching(/Bill S-3 has a problem on row 6/)],
      [7, "Give the shop: party (and area) or phone"],
      [8, expect.stringMatching(/may have only letters, digits/)],
      [9, "scheme_amount must be a number in rupees"],
    ].sort((a, b) => (a[0] as number) - (b[0] as number)));
    expect(templateCsv("sales").split("\r\n")[0]).toContain("discount_pct,scheme_amount,deal,gst_rate");
  });

  it("works a line out: % one after another, then the scheme, then GST", () => {
    // 48 × ₹95 incl. 5% = 4560; −10% = 4104; −5% = 3898.80; −₹25 = 3873.80 incl. GST.
    const m = saleLineMoney({ rate: 9500, quantity: 48, discountPct: 10, discount2Pct: 5, discount3Pct: 0, schemeAmount: 2500 }, 5, true);
    expect(m.total).toBe(387380);
    // Before GST: 100 × ₹10 − 10% − ₹50 = 850 + 18%.
    expect(saleLineMoney({ rate: 1000, quantity: 100, discountPct: 10, discount2Pct: 0, discount3Pct: 0, schemeAmount: 5000 }, 18, false)).toMatchObject({ taxable: 85000, tax: 15300 });
  });
});

describe("sales bills into the books (rolled back)", () => {
  it("books each bill as a sale with its own number, a bill and free goods; moves our series past it; refuses repeats", async () => {
    await inRollback(async (ctx) => {
      const { tx } = ctx;
      // Our running series: prefix Q, 6 digits.
      const t = await tx.tenant.findUniqueOrThrow({ where: { id: T }, select: { settings: true } });
      const settings = (t.settings ?? {}) as Record<string, unknown>;
      const inv = (settings.invoice ?? {}) as Record<string, unknown>;
      await tx.tenant.update({
        where: { id: T },
        data: { settings: { ...settings, invoice: { ...INVOICE_DEFAULTS, ...inv, city: "Mumbai", pinCode: "400093", numbering: { style: "running", digits: 6 }, prefixes: { ...INVOICE_DEFAULTS.prefixes, tax: "Q" } } } as object },
      });
      const area = await tx.area.findFirstOrThrow();
      const cat = await tx.category.create({ data: { name: `Sales import cat ${run}` } });
      const tea = await tx.product.create({ data: { name: `Test sale tea ${run}`, sku: `SI-TEA-${run}`, categoryId: cat.id, unit: "pc", price: 9500, mrp: 12000, gstRate: 5, hsnCode: "0902" } });
      const soap = await tx.product.create({ data: { name: `Test sale soap ${run}`, sku: `SI-SOAP-${run}`, categoryId: cat.id, unit: "pc", price: 5000, mrp: 8000, gstRate: 18, hsnCode: "3401" } });
      const shop = await tx.user.create({
        data: {
          name: `Sale import shop ${run}`,
          phone: `7${run}123`,
          role: "RETAILER",
          retailerProfile: { create: { outletName: `Sale import shop ${run}`, shopNumber: "1", complexName: "Market", pinCode: "400001", areaId: area.id, paymentMode: "POSTPAID", creditLimit: null } },
        },
        include: { retailerProfile: true },
      });
      const shopId = shop.retailerProfile!.id;
      const seqNo = 900000 + (Number(run) % 90000);
      const ours = `Q${seqNo}`;
      const other = `M/${run}`;
      const name = `Sale import shop ${run}`;

      const sheet = rows(
        HEAD,
        [name, "", "", ours, "21/11/2026", "", tea.sku, "48", "", "95", "10+5", "25", "24+1", "", "yes", "4464"],
        [name, "", "", ours, "21/11/2026", "", soap.sku, "10", "", "59", "", "", "", "", "yes", ""],
        ["", "", `7${run}123`, other, "22/11/2026", "", tea.sku, "10", "", "100", "", "", "", "", "no", ""],
        [name, "", "", `T${run}`, "22/11/2026", "", tea.sku, "10", "", "100", "", "", "", "", "no", "2000"],
        [name, "", "", `U${run}`, "22/11/2026", "", "NO-SUCH-SKU", "10", "", "100", "", "", "", "", "no", ""],
      );
      const v = validateSales(sheet, new Date("2026-11-25T06:00:00Z"));
      expect(v.errors).toEqual([]);
      const s = await importSales(ctx, v.valid);
      expect(s.created).toBe(2);
      expect(s.errors.map((e) => [e.row, e.message])).toEqual([
        [5, expect.stringMatching(/the lines come to ₹1050\.00, ₹950\.00 away from bill_total/)],
        [6, expect.stringMatching(/Row 6: no product with SKU NO-SUCH-SKU/)],
      ]);

      const a = await tx.invoice.findFirstOrThrow({ where: { number: ours }, include: { lines: { orderBy: { sl: "asc" } } } });
      // Tea 3873.80 incl. 5%; soap 10 × ₹59 incl. 18% = 590.00 → 4463.80.
      expect(a).toMatchObject({ type: "TAX_INVOICE", orderId: null, retailerId: shopId, total: 446380, einvStatus: "NOT_REQUIRED" });
      expect(a.date.toISOString().slice(0, 10)).toBe("2026-11-21");
      expect(a.lines.map((l) => [l.description, l.quantity, l.freeQty, l.total])).toEqual([
        [tea.name, 48, 0, 387380],
        [`${tea.name} (free)`, 2, 2, 0],
        [soap.name, 10, 0, 59000],
      ]);
      const bill = await tx.bill.findFirstOrThrow({ where: { number: ours } });
      expect(bill).toMatchObject({ retailerId: shopId, amount: 446380, paid: 0, kind: "ORDER" });
      const entry = await tx.journalEntry.findUniqueOrThrow({ where: { id: a.entryId! }, include: { lines: true } });
      expect(entry.kind).toBe("SALE");
      expect(entry.lines.reduce((x, l) => x + l.amount, 0)).toBe(0);
      // Our series won't issue Q<seq> again.
      expect(await nextRunningNumber(tx, T, "TAX_INVOICE")).toBeGreaterThan(seqNo);

      // Found by phone; a number outside our series leaves the counter alone.
      const b = await tx.invoice.findFirstOrThrow({ where: { number: other } });
      expect(b).toMatchObject({ retailerId: shopId, total: 105000 });

      // The same sheet again: both bills are refused, nothing doubles.
      const again = await importSales(ctx, validateSales(sheet.slice(0, 3), new Date("2026-11-25T06:00:00Z")).valid);
      expect(again.created).toBe(0);
      expect(again.errors.map((e) => e.message)).toEqual([
        expect.stringMatching(new RegExp(`Bill ${ours} is already in VBiz Pro`)),
        expect.stringMatching(new RegExp(`Bill ${ours} is already in VBiz Pro`)),
        expect.stringMatching(/is already in VBiz Pro/),
      ]);
      expect(await tx.invoice.count({ where: { number: { in: [ours, other] } } })).toBe(2);
    });
  });
});
