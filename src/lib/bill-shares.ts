import type { Tx } from "@/lib/db";
import type { BillShareRow, RowError } from "@/lib/importers";

/**
 * Company split of bills brought over from the old book (import type
 * bill_shares). Each bill's shares replace any it had and must add up
 * to the bill: a difference of up to ₹1 goes on its biggest share. Bills
 * raised here are refused (their split comes from the invoice lines).
 * New companies are created as suppliers.
 */
export async function applyBillShares(tx: Tx, rows: BillShareRow[]): Promise<{ created: number; updated: number; errors: RowError[] }> {
  const s = { created: 0, updated: 0, errors: [] as RowError[] };
  const byBill = new Map<string, BillShareRow[]>();
  for (const r of rows) byBill.set(r.number, [...(byBill.get(r.number) ?? []), r]);
  const bills = new Map(
    (await tx.bill.findMany({ where: { number: { in: [...byBill.keys()] } }, select: { id: true, number: true, amount: true, orderId: true, _count: { select: { shares: true } } } })).map((b) => [b.number, b])
  );
  const companies = new Map((await tx.supplier.findMany({ select: { id: true, name: true } })).map((c) => [c.name.toLowerCase(), c.id]));
  const rupees = (p: number) => `₹${(p / 100).toFixed(2)}`;
  for (const [number, list] of byBill) {
    const fail = (message: string) => list.forEach((r) => s.errors.push({ row: r.row, message }));
    const bill = bills.get(number);
    if (!bill) {
      fail(`No bill ${number} (import open bills first)`);
      continue;
    }
    if (bill.orderId) {
      fail(`Bill ${number} was raised here; its company split comes from its invoice`);
      continue;
    }
    const total = list.reduce((t, r) => t + r.amount, 0);
    const diff = bill.amount - total;
    if (Math.abs(diff) > 100) {
      fail(`Shares of bill ${number} add up to ${rupees(total)}; the bill is ${rupees(bill.amount)}`);
      continue;
    }
    const shares = list.map((r) => ({ company: r.company, amount: r.amount }));
    shares.reduce((big, x) => (x.amount > big.amount ? x : big)).amount += diff;
    await tx.billShare.deleteMany({ where: { billId: bill.id } });
    for (const x of shares) {
      let supplierId = companies.get(x.company.toLowerCase());
      if (!supplierId) {
        supplierId = (await tx.supplier.create({ data: { name: x.company } })).id;
        companies.set(x.company.toLowerCase(), supplierId);
      }
      await tx.billShare.create({ data: { billId: bill.id, supplierId, amount: x.amount } });
    }
    if (bill._count.shares) s.updated++;
    else s.created++;
  }
  return s;
}
