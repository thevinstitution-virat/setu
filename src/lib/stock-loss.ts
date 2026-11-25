import type { StockMoveKind, StockPlace } from "@/generated/prisma/client";
import { post, type Ctx } from "@/lib/ledger";
import { hasFeature } from "@/lib/plans";
import { formatINR } from "@/lib/money";
import { MOVE_LABEL, reasonLabel } from "@/lib/inventory-settings";

/**
 * Stock losses shown in the books (T3).
 *
 * The books keep purchases as an expense and work out closing stock at cost
 * from warehouses and vans (the damaged bin is not counted). So goods that go
 * bad, run out of date or go missing already lower profit, through a lower
 * closing stock, but nowhere does the loss show by name.
 *
 * Each such move now posts its value at cost (the batch's cost, else the
 * product's last cost) out of Purchases into Stock loss: Dr Stock loss,
 * Cr Purchases. A surplus posts the other way. Profit is unchanged by these
 * entries; they only move the loss out of "hidden in closing stock" onto its
 * own line. It is the same pair of accounts an accepted stock count uses.
 *
 *   - Into the damaged bin from a warehouse or van (damaged, expired,
 *     leaking, or found damaged at unload): a loss.
 *   - Goods a shop sent back damaged or expired, into the damaged bin: a loss
 *     (the sale is reversed by the credit note, the goods don't come back
 *     into stock).
 *   - Written off from a warehouse or van: a loss. Written off from the
 *     damaged bin: nothing more, it was counted when it went in.
 *   - A manual adjustment at a warehouse or van (found, lost, sample, own
 *     use, other; extra or missing at unload): a surplus or a loss.
 *   - Damaged goods sent back to the company from the damaged bin: the loss
 *     is reversed (Dr Purchases, Cr Stock loss), since the company takes
 *     them back, by a debit note (purchase returns) or against a claim.
 *
 * Not posted: purchases, sales, transfers, loading, good returns, supplier
 * returns from stock (their own documents carry the money), opening stock,
 * the stock count's own adjustments (the count posts one entry for its net),
 * and the automatic "records were short" corrections.
 *
 * Only for a business that keeps its books here (the books module).
 */

/** Adjustment reasons that never post: the count posts its own entry; the others only correct the records. */
const NO_POST_REASONS = new Set(["count", "opening", "sold_unrecorded", "loaded_unrecorded"]);
const COUNTED: StockPlace[] = ["WAREHOUSE", "VAN"];
const counted = (k: StockPlace | null | undefined) => !!k && COUNTED.includes(k);

/**
 * +1: a loss (counted stock goes bad or missing), −1: a surplus or a loss
 * taken back, 0: nothing to post.
 */
export function lossSign(kind: StockMoveKind, reason: string | null | undefined, from: StockPlace | null | undefined, to: StockPlace | null | undefined): -1 | 0 | 1 {
  switch (kind) {
    case "DAMAGE":
      return counted(from) && to === "DAMAGED" ? 1 : 0;
    case "RETURN":
      return to === "DAMAGED" ? 1 : 0;
    case "WRITE_OFF":
      return counted(from) ? 1 : 0;
    case "SUPPLIER_RETURN":
      return from === "DAMAGED" ? -1 : 0;
    case "ADJUST":
      if (reason && NO_POST_REASONS.has(reason)) return 0;
      if (counted(to) && !from) return -1;
      if (counted(from) && !to) return 1;
      return 0;
    default:
      return 0;
  }
}

/** Could this kind of move ever post? (Saves the lookups for sales, loads …) */
const mayPost = (kind: StockMoveKind, reason: string | null | undefined) =>
  kind === "DAMAGE" || kind === "RETURN" || kind === "WRITE_OFF" || kind === "SUPPLIER_RETURN" || (kind === "ADJUST" && !(reason && NO_POST_REASONS.has(reason)));

export type LossRow = { qty: number; unitCost: number | null; fromId?: string | null; toId?: string | null };
export type Booked = { entryId: string | null; values: (number | null)[] };

/**
 * Values the rows of one stock action and posts one entry for their net.
 * Returns the entry and each row's signed value (loss +, surplus −), to be
 * written on the moves; values are null when nothing was posted.
 */
export async function bookStockLoss(
  ctx: Ctx,
  p: { kind: StockMoveKind; reason?: string | null; productId: string; rows: LossRow[]; at?: Date }
): Promise<Booked> {
  const none: Booked = { entryId: null, values: p.rows.map(() => null) };
  if (!p.rows.length || !mayPost(p.kind, p.reason)) return none;
  if (!(await hasFeature(ctx.tenantId, "books"))) return none;

  const ids = [...new Set(p.rows.flatMap((r) => [r.fromId, r.toId]).filter((x): x is string => !!x))];
  const places = await ctx.tx.stockLocation.findMany({ where: { id: { in: ids } }, select: { id: true, kind: true, name: true } });
  const kindOf = new Map(places.map((l) => [l.id, l.kind]));
  const product = await ctx.tx.product.findUnique({ where: { id: p.productId }, select: { name: true, unit: true, lastCost: true } });

  let net = 0;
  let qty = 0;
  const values = p.rows.map((r) => {
    const sign = lossSign(p.kind, p.reason, r.fromId ? kindOf.get(r.fromId) : null, r.toId ? kindOf.get(r.toId) : null);
    if (!sign) return 0;
    const v = sign * r.qty * (r.unitCost ?? product?.lastCost ?? 0);
    net += v;
    qty += sign * r.qty;
    return v;
  });
  if (net === 0) return none;

  const where = places.find((l) => counted(l.kind))?.name ?? places[0]?.name;
  const why = reasonLabel(p.reason) || MOVE_LABEL[p.kind];
  const what = `${Math.abs(qty)} ${product?.unit ?? ""} of ${product?.name ?? "goods"}`.replace(/\s+/g, " ");
  const memo =
    p.kind === "SUPPLIER_RETURN"
      ? `Damaged goods back to the company: ${what}, ${formatINR(-net)} out of stock loss`
      : `${net > 0 ? "Stock loss" : "Stock surplus"}, ${MOVE_LABEL[p.kind].toLowerCase()}${why !== MOVE_LABEL[p.kind] ? ` (${why.toLowerCase()})` : ""}: ${what}${where ? ` at ${where}` : ""}, ${formatINR(Math.abs(net))}`;
  const e = await post(ctx, {
    kind: "STOCK_MOVE",
    memo: memo.slice(0, 300),
    occurredAt: p.at,
    lines: [
      { account: { type: "STOCK_LOSS" }, amount: net },
      { account: { type: "PURCHASES" }, amount: -net },
    ],
  });
  return { entryId: e.id, values: values.map((v) => (v === 0 ? null : v)) };
}
