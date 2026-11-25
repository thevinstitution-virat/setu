import { bookImportedSale, MoneyError, type Ctx } from "@/lib/ledger";
import { lineMoney } from "@/lib/money";
import { purchaseLineMoney } from "@/lib/purchase-math";
import { uqc } from "@/lib/gst";
import type { Draft } from "@/lib/invoice";
import type { RowError, SalesImportBill } from "@/lib/importers";

/**
 * Sales bills from the old book (one row per line): each becomes a sale
 * invoice with its own number and date, booked on that date, with a bill for
 * the outstanding. Shops by phone, else by party (+ area); products by SKU;
 * the salesman by name or login. Stock doesn't move. Each bill is written in
 * a savepoint, so a refused one leaves nothing behind.
 */

export type SalesImportSummary = { created: number; updated: number; errors: RowError[] };

const norm = (v: string) => v.trim().replace(/\s+/g, " ").toLowerCase();

/** Noon in India on that day, so the bill sits on the right day in every report. */
const istNoon = (day: string) => new Date(`${day}T12:00:00+05:30`);

/**
 * One line's money: the % discounts one after another, then the scheme (all
 * in the rate's terms, with GST when the rates include it), then GST with the
 * same rounding as a bill made here.
 */
export function saleLineMoney(l: { rate: number; quantity: number; discountPct: number; discount2Pct: number; discount3Pct: number; schemeAmount: number }, gstRate: number, inclusive: boolean) {
  const cuts = purchaseLineMoney(l.rate, l.quantity, l.discountPct, 0, false, false, { more: [l.discount2Pct, l.discount3Pct], scheme: l.schemeAmount });
  return lineMoney(l.rate, l.quantity, cuts.discount + cuts.scheme, gstRate, inclusive);
}

export async function importSales(ctx: Ctx, bills: SalesImportBill[]): Promise<SalesImportSummary> {
  const s: SalesImportSummary = { created: 0, updated: 0, errors: [] };
  const shops = await ctx.tx.retailerProfile.findMany({ select: { id: true, outletName: true, area: { select: { name: true } }, user: { select: { phone: true } } } });
  const byPhone = new Map(shops.filter((p) => p.user.phone).map((p) => [p.user.phone!, p.id]));
  const products = new Map(
    (await ctx.tx.product.findMany({ select: { id: true, sku: true, name: true, gstRate: true, hsnCode: true, unit: true, caseSize: true } })).map((p) => [norm(p.sku), p]),
  );
  const staff = await ctx.tx.user.findMany({ where: { role: { in: ["SALES_AGENT", "SUPERVISOR", "ADMIN", "DELIVERY_AGENT"] } }, select: { id: true, name: true, loginId: true } });

  const findShop = (b: SalesImportBill): string => {
    if (b.phone) {
      const id = byPhone.get(b.phone);
      if (!id) throw new MoneyError(`No shop with phone ${b.phone} (import shops first)`);
      return id;
    }
    let same = shops.filter((p) => norm(p.outletName) === norm(b.party));
    if (same.length > 1 && b.area) same = same.filter((p) => norm(p.area.name) === norm(b.area));
    if (!same.length) throw new MoneyError(`No shop called ${b.party}${b.area ? ` in ${b.area}` : ""} (import shops first)`);
    if (same.length > 1) throw new MoneyError(`${same.length} shops are called ${b.party}; add the area or phone`);
    return same[0].id;
  };
  const findSalesman = (name: string) => {
    if (!name) return null;
    const hits = staff.filter((u) => norm(u.name) === norm(name) || (u.loginId && norm(u.loginId) === norm(name)));
    if (hits.length !== 1) throw new MoneyError(hits.length ? `${hits.length} staff are called ${name}` : `No staff member called ${name} (add them under Team first)`);
    return hits[0];
  };

  for (const b of bills) {
    try {
      const retailerId = findShop(b);
      const salesman = findSalesman(b.salesman);
      const drafts: Draft[] = [];
      for (const l of b.lines) {
        const p = products.get(norm(l.sku));
        if (!p) throw new MoneyError(`Row ${l.row}: no product with SKU ${l.sku}`);
        const gstRate = l.gstRate ?? p.gstRate;
        const m = saleLineMoney(l, gstRate, b.ratesIncludeGst);
        if (m.taxable <= 0) throw new MoneyError(`Row ${l.row}: the discounts and scheme take the whole line`);
        const unit = uqc(p.unit);
        const common = { productId: p.id, orderItemId: null, originalLineId: null, hsnCode: p.hsnCode, isService: false, unit, gstRate, mrp: l.mrp, caseSize: p.caseSize ?? null };
        drafts.push({
          ...common,
          description: p.name,
          quantity: l.quantity,
          freeQty: 0,
          // The invoice's rate is before GST; with inclusive rates it is the line's taxable gross per unit.
          rate: b.ratesIncludeGst && gstRate > 0 ? Math.round(m.gross / l.quantity) : l.rate,
          gross: m.gross,
          discount: m.discount,
          tax: m.tax,
          inclRate: b.ratesIncludeGst ? l.rate : null,
        });
        if (l.freeQty > 0) {
          drafts.push({ ...common, description: `${p.name} (free)`, quantity: l.freeQty, freeQty: l.freeQty, rate: 0, gross: 0, discount: 0, tax: 0, inclRate: 0 });
        }
      }
      // The old book's printed total: the paise between it and the lines are the bill's round-off.
      let roundOff = 0;
      if (b.billTotal !== null) {
        const total = drafts.reduce((a, d) => a + d.gross - d.discount + d.tax, 0);
        if (Math.abs(total - b.billTotal) >= 100) {
          throw new MoneyError(`Bill ${b.number}: the lines come to ₹${(total / 100).toFixed(2)}, ₹${(Math.abs(total - b.billTotal) / 100).toFixed(2)} away from bill_total. Check the lines.`);
        }
        roundOff = b.billTotal - total;
      }
      await ctx.tx.$executeRawUnsafe("SAVEPOINT sales_import");
      try {
        await bookImportedSale(ctx, {
          retailerId,
          number: b.number,
          date: istNoon(b.date),
          dueDate: b.dueDate ? istNoon(b.dueDate) : null,
          salesmanId: salesman?.id ?? null,
          salesman: salesman?.name ?? null,
          drafts,
          roundOff,
        });
        await ctx.tx.$executeRawUnsafe("RELEASE SAVEPOINT sales_import");
      } catch (e) {
        await ctx.tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT sales_import");
        throw e;
      }
      s.created++;
    } catch (e) {
      if (!(e instanceof MoneyError) && (e as { code?: string })?.code !== "P2002") throw e;
      const msg = e instanceof MoneyError ? e.message : "Already entered";
      b.rows.forEach((row) => s.errors.push({ row, message: msg }));
    }
  }
  return s;
}
