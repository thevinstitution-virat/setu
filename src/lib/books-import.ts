import { MoneyError, type Ctx } from "@/lib/ledger";
import { parseSupplier } from "@/lib/supplier-api";
import { openingSupplierBills, recordPurchase, type OpeningSupplierBill, type PurchaseLineInput } from "@/lib/purchases";
import { todayIst } from "@/lib/books";
import { addDay, booksStart } from "@/lib/final-accounts";
import type { PurchaseImportBill, RowError, SupplierBillImportRow, SupplierImportRow } from "@/lib/importers";

/**
 * A2.6: bring suppliers, their open bills on the switch date, and purchase
 * bills in from a CSV or Excel sheet. Each supplier / bill is written inside
 * a savepoint, so a refused one leaves nothing behind and the rest go in.
 */

export type BooksImportSummary = { created: number; updated: number; errors: RowError[] };

const norm = (v: string) => v.trim().replace(/\s+/g, " ").toLowerCase();

async function attempt<T>(ctx: Ctx, fn: () => Promise<T>): Promise<T> {
  await ctx.tx.$executeRawUnsafe("SAVEPOINT books_import");
  try {
    const r = await fn();
    await ctx.tx.$executeRawUnsafe("RELEASE SAVEPOINT books_import");
    return r;
  } catch (e) {
    await ctx.tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT books_import");
    throw e;
  }
}

const message = (e: unknown) => {
  if (e instanceof MoneyError) return e.message;
  if ((e as { code?: string })?.code === "P2002") return "Already entered";
  throw e;
};

async function suppliersByName(ctx: Ctx) {
  const list = await ctx.tx.supplier.findMany({ select: { id: true, name: true, active: true } });
  return new Map(list.map((s) => [norm(s.name), s]));
}

/** Suppliers: matched by name, a new one is added, one already here gets the cells that were filled in. */
export async function importSuppliers(ctx: Ctx, rows: SupplierImportRow[]): Promise<BooksImportSummary> {
  const s: BooksImportSummary = { created: 0, updated: 0, errors: [] };
  const known = await suppliersByName(ctx);
  for (const r of rows) {
    const had = known.get(norm(r.name));
    const data = parseSupplier(had ? r.fields : { name: r.name, ...r.fields }, !!had);
    if (typeof data === "string") {
      s.errors.push({ row: r.row, message: data });
      continue;
    }
    try {
      await attempt(ctx, async () => {
        if (had) {
          if (Object.keys(data).length) await ctx.tx.supplier.update({ where: { id: had.id }, data });
        } else {
          const n = await ctx.tx.supplier.create({ data: data as { name: string } });
          known.set(norm(n.name), { id: n.id, name: n.name, active: true });
        }
      });
      if (had) s.updated++;
      else s.created++;
    } catch (e) {
      s.errors.push({ row: r.row, message: message(e) });
    }
  }
  return s;
}

/** The day the opening balances are as of: the day before the books start here, else today. */
async function openingDay(ctx: Ctx) {
  const b = await booksStart(ctx);
  return b.set && b.start ? addDay(b.start, -1) : todayIst();
}

/** Suppliers' open bills on the switch date: all of a supplier's bills (and any advance) in one go, once. */
export async function importSupplierBills(ctx: Ctx, rows: SupplierBillImportRow[]): Promise<BooksImportSummary> {
  const s: BooksImportSummary = { created: 0, updated: 0, errors: [] };
  const known = await suppliersByName(ctx);
  const asOf = await openingDay(ctx);
  const groups = new Map<string, { bills: OpeningSupplierBill[]; advance: number; rows: number[] }>();
  for (const r of rows) {
    const sup = known.get(norm(r.supplier));
    if (!sup) {
      s.errors.push({ row: r.row, message: `No supplier called ${r.supplier} (import suppliers first)` });
      continue;
    }
    if (r.date && r.date > asOf) {
      s.errors.push({ row: r.row, message: `The bill is dated after the opening day (${asOf}): enter it as a purchase bill` });
      continue;
    }
    const g = groups.get(sup.id) ?? { bills: [], advance: 0, rows: [] };
    g.rows.push(r.row);
    if (r.number === null) g.advance += -r.amount;
    else g.bills.push({ number: r.number, date: r.date!, dueDate: r.dueDate, amount: r.amount, paid: r.paid });
    groups.set(sup.id, g);
  }
  for (const [supplierId, g] of groups) {
    try {
      await attempt(ctx, () => openingSupplierBills(ctx, supplierId, g.bills, g.advance, asOf));
      s.created += g.bills.length + (g.advance > 0 ? 1 : 0);
    } catch (e) {
      const m = message(e);
      for (const row of g.rows) s.errors.push({ row, message: m });
    }
  }
  return s;
}

/** Purchase bills, line by line: products by SKU, other lines by account head name. Goods are not moved into stock. */
export async function importPurchases(ctx: Ctx, bills: PurchaseImportBill[]): Promise<BooksImportSummary> {
  const s: BooksImportSummary = { created: 0, updated: 0, errors: [] };
  const known = await suppliersByName(ctx);
  const products = new Map((await ctx.tx.product.findMany({ select: { id: true, sku: true, name: true, gstRate: true } })).map((p) => [norm(p.sku), p]));
  const heads = new Map((await ctx.tx.ledgerHead.findMany({ select: { id: true, name: true, active: true } })).map((h) => [norm(h.name), h]));
  for (const b of bills) {
    const fail = (m: string) => b.rows.forEach((row) => s.errors.push({ row, message: m }));
    const sup = known.get(norm(b.supplier));
    if (!sup) {
      fail(`No supplier called ${b.supplier} (import suppliers first)`);
      continue;
    }
    const lines: PurchaseLineInput[] = [];
    let bad: string | null = null;
    for (const l of b.lines) {
      if (l.sku) {
        const p = products.get(norm(l.sku));
        if (!p) {
          bad = `Row ${l.row}: no product with SKU ${l.sku}`;
          break;
        }
        lines.push({ target: "GOODS", productId: p.id, description: l.item, quantity: l.quantity, freeQty: l.freeQty, rate: l.rate, discountPct: l.discountPct, gstRate: l.gstRate ?? p.gstRate });
      } else {
        const h = heads.get(norm(l.head!));
        if (!h) {
          bad = `Row ${l.row}: no account head called ${l.head} (add it under Books → Accounts)`;
          break;
        }
        lines.push({ target: "HEAD", headId: h.id, description: l.item ?? h.name, quantity: l.quantity, rate: l.rate, discountPct: l.discountPct, gstRate: l.gstRate ?? 0 });
      }
    }
    if (bad) {
      fail(bad);
      continue;
    }
    try {
      await attempt(ctx, () =>
        recordPurchase(ctx, {
          type: "BILL",
          supplierId: sup.id,
          supplierRef: b.number,
          date: b.date,
          dueDate: b.dueDate,
          ratesIncludeGst: b.ratesIncludeGst,
          reverseCharge: b.reverseCharge,
          billTotal: b.billTotal,
          note: "Imported from a sheet",
          lines,
        }),
      );
      s.created++;
    } catch (e) {
      fail(message(e));
    }
  }
  return s;
}
