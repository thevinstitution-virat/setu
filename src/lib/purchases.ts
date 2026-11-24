import type { AccountGroup, PurchaseDocType, PurchaseLineTarget, SupplierKind } from "@/generated/prisma/client";
import { addDays, MoneyError, post, reverseEntry, type AccountRef, type Ctx, type Line } from "@/lib/ledger";
import { DOC_LABEL, GST_RATES, purchaseLineMoney } from "@/lib/purchase-math";
import { docNumber, fyCode, isStateCode } from "@/lib/gst";
import { nextSequence } from "@/lib/orders";
import { defaultWarehouse, receiveGoods, stockOn, stockOut } from "@/lib/stock";
import { dayEnd, dayStart, isDay, todayIst } from "@/lib/books";

/**
 * Purchases (A2): a supplier's bill, our debit note to them, their credit
 * note to us. Each posts one balanced entry, keeps what we owe the supplier
 * bill by bill (SupplierBill / SupplierCredit, like a shop's khata the other
 * way round), and can bring goods into stock or send them back.
 *
 *   Bill:         Dr Purchases / head (taxable + tax we can't claim)
 *                 Dr GST input (tax we can claim)       Cr Supplier (total)
 *   Debit note:   Dr Supplier                          Cr Purchase returns / head, GST input
 *   Credit note:  Dr Supplier                          Cr Purchases / head / claims, GST input
 *   Reverse charge: the supplier is owed the value only; the tax is ours to pay (GST output).
 */

export { GST_RATES, DOC_LABEL, SUPPLIER_KINDS, purchaseLineMoney, type LineMoney } from "@/lib/purchase-math";
const PREFIX: Record<PurchaseDocType, string> = { BILL: "PB", DEBIT_NOTE: "PDN", CREDIT_NOTE: "PCN" };
/** Head groups a purchase line can be charged to. */
export const PURCHASE_HEAD_GROUPS: AccountGroup[] = ["DIRECT_EXPENSES", "INDIRECT_EXPENSES", "FIXED_ASSETS", "CURRENT_ASSETS"];

// ───────────────────────────── input ─────────────────────────────

export type PurchaseLineInput = {
  target?: PurchaseLineTarget;
  productId?: string | null;
  headId?: string | null;
  description?: string | null;
  quantity: number;
  freeQty?: number;
  rate: number;
  discountPct?: number;
  gstRate?: number;
  itc?: boolean;
  /** Line of the goods received note being billed. */
  purchaseLineId?: string | null;
  batch?: string | null;
  expiry?: string | null;
};

export type PurchaseInput = {
  type?: PurchaseDocType;
  supplierId: string;
  /** Their bill / note number. A debit note may leave it blank (ours is used). */
  supplierRef?: string | null;
  date: string;
  dueDate?: string | null;
  stateCode?: string | null;
  reverseCharge?: boolean;
  ratesIncludeGst?: boolean;
  /** Notes: the bill they are against. */
  againstId?: string | null;
  /** Bill: the goods received note it is for. */
  purchaseId?: string | null;
  /** Bill: bring its goods into stock now (stock tracking on, no GRN). Debit note: take them out. */
  moveStock?: boolean;
  reason?: string | null;
  note?: string | null;
  /** The total printed on the supplier's bill; the difference (up to ₹1) is rounding. Blank = round to the rupee. */
  billTotal?: number | null;
  lines: PurchaseLineInput[];
};

/** "YYYY-MM-DD" + n days. */
const plusDays = (day: string, n: number) => addDays(new Date(`${day}T00:00:00Z`), n).toISOString().slice(0, 10);
const isInt = (v: unknown, min: number, max: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");

// ───────────────────────────── posting ─────────────────────────────

/** Record a purchase bill or note: the document, its entry, the supplier's bill or credit, and any stock. */
export async function recordPurchase(ctx: Ctx, input: PurchaseInput) {
  const type: PurchaseDocType = input.type ?? "BILL";
  if (!(type in DOC_LABEL)) throw new MoneyError("Unknown document type");
  const supplier = await ctx.tx.supplier.findUnique({ where: { id: String(input.supplierId) } });
  if (!supplier || !supplier.active) throw new MoneyError("Supplier not found", 404);
  await lockSupplier(ctx, supplier.id);

  if (!isDay(input.date)) throw new MoneyError("Enter the bill date");
  if (input.date > todayIst()) throw new MoneyError("The bill date is in the future");
  const due = type === "BILL" ? (input.dueDate ? (isDay(input.dueDate) ? input.dueDate : null) : plusDays(input.date, supplier.creditDays)) : null;
  if (type === "BILL" && !due) throw new MoneyError("Enter a valid due date");
  if (due && due < input.date) throw new MoneyError("The due date is before the bill date");

  const tenant = await ctx.tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { stateCode: true } });
  const stateCode = (input.stateCode && isStateCode(input.stateCode) ? input.stateCode : null) ?? supplier.stateCode ?? (supplier.gstin ? supplier.gstin.slice(0, 2) : null) ?? tenant.stateCode;
  const interState = !!stateCode && !!tenant.stateCode && stateCode !== tenant.stateCode;
  const inclusive = !!input.ratesIncludeGst;
  const rcm = !!input.reverseCharge;

  const against = input.againstId ? await ctx.tx.purchaseBill.findUnique({ where: { id: input.againstId } }) : null;
  if (input.againstId) {
    if (type === "BILL") throw new MoneyError("Only a note can be against a bill");
    if (!against || against.type !== "BILL" || against.cancelledAt) throw new MoneyError("The bill it is against was not found", 404);
    if (against.supplierId !== supplier.id) throw new MoneyError("That bill is from another supplier");
  }

  const grn = input.purchaseId ? await ctx.tx.purchase.findUnique({ where: { id: input.purchaseId }, include: { lines: true, bill: { select: { id: true, number: true } } } }) : null;
  if (input.purchaseId) {
    if (type !== "BILL") throw new MoneyError("Only a bill can be for goods received");
    if (!grn) throw new MoneyError("Goods received note not found", 404);
    if (grn.supplierId !== supplier.id) throw new MoneyError("Those goods came from another supplier");
    if (grn.bill) throw new MoneyError(`${grn.number} is already billed on ${grn.bill.number}`, 409);
  }
  const moveStock = !!input.moveStock && !grn;
  if (moveStock && !(await stockOn(ctx))) throw new MoneyError("Stock tracking is off, so goods can't be moved with this bill");
  if (moveStock && type === "CREDIT_NOTE") throw new MoneyError("A credit note doesn't move goods");

  if (!Array.isArray(input.lines) || input.lines.length === 0 || input.lines.length > 300) throw new MoneyError("Add 1 to 300 lines");
  const lines = [];
  for (const [i, raw] of input.lines.entries()) {
    const n = `Line ${i + 1}`;
    const target: PurchaseLineTarget = raw.target ?? (raw.productId ? "GOODS" : raw.headId ? "HEAD" : "CLAIM");
    let description = text(raw.description, 120);
    let hsnCode: string | null = null;
    let productId: string | null = null;
    let headId: string | null = null;
    if (target === "GOODS") {
      const p = raw.productId ? await ctx.tx.product.findUnique({ where: { id: String(raw.productId) }, select: { id: true, name: true, hsnCode: true } }) : null;
      if (!p) throw new MoneyError(`${n}: pick the product`);
      productId = p.id;
      description ||= p.name;
      hsnCode = p.hsnCode ?? null;
    } else if (target === "HEAD") {
      const h = raw.headId ? await ctx.tx.ledgerHead.findUnique({ where: { id: String(raw.headId) } }) : null;
      if (!h) throw new MoneyError(`${n}: pick the account head`);
      if (!h.active) throw new MoneyError(`${n}: ${h.name} is hidden`);
      headId = h.id;
      description ||= h.name;
    } else if (target === "CLAIM") {
      if (type !== "CREDIT_NOTE") throw new MoneyError(`${n}: scheme and claim money comes on a credit note`);
      description ||= "Scheme / claim";
    } else throw new MoneyError(`${n}: unknown line type`);
    const quantity = Number(raw.quantity);
    const freeQty = Number(raw.freeQty ?? 0);
    const rate = Number(raw.rate);
    const discountPct = Number(raw.discountPct ?? 0);
    const gstRate = Number(raw.gstRate ?? 0);
    if (!isInt(quantity, 1, 10_000_000)) throw new MoneyError(`${n}: quantity must be a whole number, 1 or more`);
    if (!isInt(freeQty, 0, 10_000_000)) throw new MoneyError(`${n}: free quantity must be a whole number`);
    if (freeQty && target !== "GOODS") throw new MoneyError(`${n}: only goods come free`);
    if (!isInt(rate, 0, 10_000_000_000)) throw new MoneyError(`${n}: rate must be in rupees and paise`);
    if (!(discountPct >= 0 && discountPct <= 100)) throw new MoneyError(`${n}: discount must be 0 to 100%`);
    if (!GST_RATES.includes(gstRate)) throw new MoneyError(`${n}: GST rate ${gstRate}% is not a GST rate`);
    const m = purchaseLineMoney(rate, quantity, discountPct, gstRate, inclusive, interState);
    if (m.total <= 0) throw new MoneyError(`${n}: the amount is ₹0`);
    let purchaseLineId: string | null = null;
    if (raw.purchaseLineId) {
      const gl = grn?.lines.find((x) => x.id === raw.purchaseLineId);
      if (!gl) throw new MoneyError(`${n}: not a line of these goods received`);
      if (gl.productId !== productId) throw new MoneyError(`${n}: the product differs from the goods received`);
      purchaseLineId = gl.id;
    }
    const expiry = raw.expiry ? (isDay(raw.expiry) ? raw.expiry : null) : null;
    if (raw.expiry && !expiry) throw new MoneyError(`${n}: expiry must be a date`);
    lines.push({ target, productId, headId, description, hsnCode, quantity, freeQty, rate, discountPct, gstRate, itc: raw.itc !== false, purchaseLineId, batch: text(raw.batch, 40) || null, expiry, m });
  }

  const taxable = lines.reduce((s, l) => s + l.m.taxable, 0);
  const cgst = lines.reduce((s, l) => s + l.m.cgst, 0);
  const sgst = lines.reduce((s, l) => s + l.m.sgst, 0);
  const igst = lines.reduce((s, l) => s + l.m.igst, 0);
  const tax = cgst + sgst + igst;
  const itcTax = lines.reduce((s, l) => s + (l.itc ? l.m.tax : 0), 0);
  const before = taxable + (rcm ? 0 : tax);
  let roundOff: number;
  if (input.billTotal !== null && input.billTotal !== undefined && String(input.billTotal) !== "") {
    const printed = Number(input.billTotal);
    if (!Number.isInteger(printed) || printed <= 0) throw new MoneyError("The bill total must be in rupees and paise");
    roundOff = printed - before;
    if (Math.abs(roundOff) > 100) throw new MoneyError(`The lines add up to ₹${(before / 100).toFixed(2)}, ₹${(Math.abs(roundOff) / 100).toFixed(2)} away from the bill total. Check the lines.`);
  } else roundOff = Math.round(before / 100) * 100 - before;
  const total = before + roundOff;
  if (total <= 0) throw new MoneyError("The total must be more than ₹0");

  const fy = fyCode(dayStart(input.date));
  const number = docNumber(PREFIX[type], fy, await nextSequence(ctx.tx, ctx.tenantId, `${PREFIX[type].toLowerCase()}:${fy}`));
  const supplierRef = text(input.supplierRef, 40) || (type === "DEBIT_NOTE" ? number : "");
  if (!supplierRef) throw new MoneyError(type === "BILL" ? "Enter the supplier's bill number" : "Enter the supplier's note number");

  const doc = await ctx.tx.purchaseBill
    .create({
      data: {
        tenantId: ctx.tenantId,
        type,
        number,
        supplierId: supplier.id,
        supplierRef,
        date: new Date(`${input.date}T00:00:00Z`),
        dueDate: due ? new Date(`${due}T00:00:00Z`) : null,
        stateCode,
        interState,
        reverseCharge: rcm,
        ratesIncludeGst: inclusive,
        againstId: against?.id ?? null,
        purchaseId: grn?.id ?? null,
        reason: text(input.reason, 200) || null,
        note: text(input.note, 300) || null,
        taxable,
        cgst,
        sgst,
        igst,
        itcTax,
        roundOff,
        total,
        createdById: ctx.actorId,
        lines: {
          create: lines.map((l) => ({
            tenantId: ctx.tenantId,
            target: l.target,
            productId: l.productId,
            headId: l.headId,
            description: l.description,
            hsnCode: l.hsnCode,
            quantity: l.quantity,
            freeQty: l.freeQty,
            rate: l.rate,
            discountPct: l.discountPct,
            gstRate: l.gstRate,
            itc: l.itc,
            taxable: l.m.taxable,
            cgst: l.m.cgst,
            sgst: l.m.sgst,
            igst: l.m.igst,
            total: l.m.total,
            purchaseLineId: l.purchaseLineId,
            batch: l.batch,
            expiry: l.expiry ? new Date(`${l.expiry}T00:00:00Z`) : null,
          })),
        },
      },
      include: { lines: true },
    })
    .catch((e: unknown) => {
      if ((e as { code?: string })?.code === "P2002") throw new MoneyError(`${supplierRef} from ${supplier.name} is already entered`, 409);
      throw e;
    });

  // The entry: costs and tax one side, the supplier the other. Notes are the mirror image.
  const sign = type === "BILL" ? 1 : -1;
  const acc = new Map<string, { account: AccountRef; amount: number }>();
  const add = (account: AccountRef, amount: number) => {
    const k = JSON.stringify(account);
    const cur = acc.get(k) ?? { account, amount: 0 };
    cur.amount += amount;
    acc.set(k, cur);
  };
  for (const l of lines) {
    const cost = l.m.taxable + (l.itc ? 0 : l.m.tax);
    const account: AccountRef =
      l.target === "HEAD" ? { type: "HEAD", headId: l.headId! } : l.target === "CLAIM" ? { type: "CLAIM_INCOME" } : { type: type === "DEBIT_NOTE" ? "PURCHASE_RETURNS" : "PURCHASES" };
    add(account, sign * cost);
  }
  add({ type: "GST_INPUT" }, sign * itcTax);
  if (rcm) add({ type: "GST_OUTPUT" }, -sign * tax);
  add({ type: "ROUND_OFF" }, sign * roundOff);
  add({ type: "PAYABLE", supplierId: supplier.id }, -sign * total);
  const entryLines: Line[] = [...acc.values()].filter((x) => x.amount !== 0);
  const entry = await post(ctx, {
    kind: type === "BILL" ? "PURCHASE" : type === "DEBIT_NOTE" ? "PURCHASE_DEBIT_NOTE" : "PURCHASE_CREDIT_NOTE",
    memo: `${DOC_LABEL[type]} ${supplierRef} from ${supplier.name}`,
    supplierId: supplier.id,
    occurredAt: new Date(`${input.date}T12:00:00+05:30`) > new Date() ? new Date() : new Date(`${input.date}T12:00:00+05:30`),
    lines: entryLines,
  });
  await ctx.tx.purchaseBill.update({ where: { id: doc.id }, data: { entryId: entry.id } });

  // What we owe, bill by bill.
  if (type === "BILL") {
    await ctx.tx.supplierBill.create({
      data: { tenantId: ctx.tenantId, supplierId: supplier.id, kind: "PURCHASE", number: supplierRef, date: doc.date, dueDate: doc.dueDate!, amount: total, purchaseBillId: doc.id, entryId: entry.id },
    });
  } else {
    const againstBill = against ? await ctx.tx.supplierBill.findUnique({ where: { purchaseBillId: against.id } }) : null;
    await ctx.tx.supplierCredit.create({
      data: { tenantId: ctx.tenantId, supplierId: supplier.id, kind: type, number, date: dayStart(input.date), amount: total, purchaseBillId: doc.id, againstBillId: againstBill?.id ?? null, entryId: entry.id, note: text(input.reason, 200) || null },
    });
  }
  await allocateSupplier(ctx, supplier.id);

  // Stock.
  const goods = doc.lines.filter((l) => l.target === "GOODS");
  const unitCost = (l: (typeof doc.lines)[number]) => Math.round((l.taxable + (l.itc ? 0 : l.cgst + l.sgst + l.igst)) / (l.quantity + l.freeQty));
  if (grn) {
    for (const l of goods) {
      if (!l.purchaseLineId) continue;
      const gl = grn.lines.find((x) => x.id === l.purchaseLineId)!;
      const c = unitCost(l);
      await ctx.tx.purchaseLine.update({ where: { id: gl.id }, data: { unitCost: c } });
      if (gl.lotId) await ctx.tx.stockLot.update({ where: { id: gl.lotId }, data: { unitCost: c } });
      await ctx.tx.product.update({ where: { id: gl.productId }, data: { lastCost: c } });
    }
    const fresh = await ctx.tx.purchaseLine.findMany({ where: { purchaseId: grn.id } });
    await ctx.tx.purchase.update({ where: { id: grn.id }, data: { total: fresh.reduce((s, x) => s + x.quantity * (x.unitCost ?? 0), 0), billNo: grn.billNo ?? supplierRef, billDate: grn.billDate ?? doc.date } });
  } else if (moveStock && type === "BILL" && goods.length) {
    const received = await receiveGoods(ctx, {
      supplierId: supplier.id,
      billNo: supplierRef,
      billDate: input.date,
      note: `From purchase bill ${number}`,
      lines: goods.map((l) => ({ productId: l.productId!, quantity: l.quantity + l.freeQty, batch: l.batch, expiry: l.expiry ? l.expiry.toISOString().slice(0, 10) : null, unitCost: unitCost(l) })),
    });
    await ctx.tx.purchaseBill.update({ where: { id: doc.id }, data: { purchaseId: received.id, movedStock: true } });
    // receiveGoods' lines come back unordered: pair each bill line with a received line of the same product and quantity.
    const pool = [...received.lines];
    for (const l of goods) {
      const at = pool.findIndex((x) => x.productId === l.productId && x.quantity === l.quantity + l.freeQty);
      if (at < 0) continue;
      const [gl] = pool.splice(at, 1);
      await ctx.tx.purchaseBillLine.update({ where: { id: l.id }, data: { purchaseLineId: gl.id } });
    }
  } else if (moveStock && type === "DEBIT_NOTE" && goods.length) {
    const wh = await defaultWarehouse(ctx);
    for (const l of goods) {
      await stockOut(ctx, { kind: "SUPPLIER_RETURN", sources: [wh.id], productId: l.productId!, qty: l.quantity + l.freeQty, onShort: "refuse", docId: doc.id, note: `Debit note ${number} to ${supplier.name}` });
    }
    await ctx.tx.purchaseBill.update({ where: { id: doc.id }, data: { movedStock: true } });
  }
  return ctx.tx.purchaseBill.findUniqueOrThrow({ where: { id: doc.id }, include: { lines: true, supplier: { select: { name: true } } } });
}

/** Cancel a bill or note entered by mistake: its entry is reversed and the supplier's account put back. */
export async function cancelPurchase(ctx: Ctx, id: string, reason: string) {
  const doc = await ctx.tx.purchaseBill.findUnique({ where: { id }, include: { notes: { where: { cancelledAt: null }, select: { number: true } } } });
  if (!doc) throw new MoneyError("Not found", 404);
  if (doc.cancelledAt) throw new MoneyError("Already cancelled", 409);
  const why = text(reason, 200);
  if (why.length < 3) throw new MoneyError("Say why it is cancelled");
  await lockSupplier(ctx, doc.supplierId);
  if (doc.movedStock) {
    throw new MoneyError(doc.type === "BILL" ? "This bill brought its goods into stock. Send them back with a debit note instead." : "This note took goods out of stock. Enter a new bill for them instead.", 409);
  }
  if (doc.notes.length) throw new MoneyError(`Cancel the notes against it first (${doc.notes.map((n) => n.number).join(", ")})`, 409);
  if (doc.type === "BILL") {
    const sb = await ctx.tx.supplierBill.findUnique({ where: { purchaseBillId: doc.id } });
    if (sb && sb.paid > 0) throw new MoneyError("Payments or notes are set against this bill. Cancel those first.", 409);
    if (sb) await ctx.tx.supplierBill.delete({ where: { id: sb.id } });
  } else {
    const cr = await ctx.tx.supplierCredit.findUnique({ where: { purchaseBillId: doc.id } });
    if (cr) {
      await deallocateCredit(ctx, cr.id);
      await ctx.tx.supplierCredit.delete({ where: { id: cr.id } });
    }
  }
  if (doc.entryId) await reverseEntry(ctx, doc.entryId, `${DOC_LABEL[doc.type]} ${doc.number} cancelled: ${why}`);
  await ctx.tx.purchaseBill.update({
    where: { id: doc.id },
    data: { cancelledAt: new Date(), cancelReason: why, purchaseId: null, supplierRef: `${doc.supplierRef} (cancelled ${doc.number})`.slice(0, 80) },
  });
  await allocateSupplier(ctx, doc.supplierId);
}

// ───────────────────────────── supplier bills ─────────────────────────────

export async function lockSupplier(ctx: Ctx, supplierId: string) {
  await ctx.tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${ctx.tenantId}:supplier:${supplierId}`}))`;
}

/** Set notes, advances and (A3) payments against the supplier's open bills: their chosen bill first, then oldest first. */
export async function allocateSupplier(ctx: Ctx, supplierId: string) {
  const bills = await ctx.tx.supplierBill.findMany({ where: { supplierId, settled: false }, orderBy: [{ date: "asc" }, { createdAt: "asc" }] });
  const credits = (await ctx.tx.supplierCredit.findMany({ where: { supplierId }, orderBy: [{ date: "asc" }, { createdAt: "asc" }] })).filter((c) => c.allocated < c.amount);
  if (!bills.length || !credits.length) return;
  const left = new Map(bills.map((b) => [b.id, b.amount - b.paid]));
  for (const c of credits) {
    let have = c.amount - c.allocated;
    const first = c.againstBillId ? bills.find((b) => b.id === c.againstBillId) : undefined;
    for (const b of first ? [first, ...bills.filter((x) => x !== first)] : bills) {
      if (have <= 0) break;
      const room = left.get(b.id)!;
      if (room <= 0) continue;
      const amt = Math.min(room, have);
      await ctx.tx.supplierAllocation.create({ data: { tenantId: ctx.tenantId, creditId: c.id, billId: b.id, amount: amt } });
      left.set(b.id, room - amt);
      have -= amt;
    }
    await ctx.tx.supplierCredit.update({ where: { id: c.id }, data: { allocated: c.amount - have } });
  }
  for (const b of bills) {
    const paid = b.amount - left.get(b.id)!;
    if (paid !== b.paid) await ctx.tx.supplierBill.update({ where: { id: b.id }, data: { paid, settled: paid >= b.amount } });
  }
}

async function deallocateCredit(ctx: Ctx, creditId: string) {
  const allocs = await ctx.tx.supplierAllocation.findMany({ where: { creditId } });
  for (const a of allocs) {
    await ctx.tx.supplierBill.update({ where: { id: a.billId }, data: { paid: { decrement: a.amount }, settled: false } });
  }
  await ctx.tx.supplierAllocation.deleteMany({ where: { creditId } });
  await ctx.tx.supplierCredit.update({ where: { id: creditId }, data: { allocated: 0 } });
}

export type OpeningSupplierBill = { number: string; date: string; dueDate?: string | null; amount: number; paid?: number };

/**
 * What we owed a supplier when moving from the old books, bill by bill (and
 * any advance paid to them). Once per supplier.
 */
export async function openingSupplierBills(ctx: Ctx, supplierId: string, bills: OpeningSupplierBill[], advance = 0, asOf = todayIst()) {
  const s = await ctx.tx.supplier.findUnique({ where: { id: supplierId } });
  if (!s) throw new MoneyError("Supplier not found", 404);
  if (!bills.length && advance <= 0) throw new MoneyError("Nothing to enter");
  if (!isInt(advance, 0, 10_000_000_000)) throw new MoneyError("Advance must be ₹0 or more");
  if (!isDay(asOf)) throw new MoneyError("Pick the date of the opening balance");
  const seen = new Set<string>();
  const rows = bills.map((b, i) => {
    const number = text(b.number, 40);
    const n = `Row ${i + 1}`;
    if (!number) throw new MoneyError(`${n}: enter the bill number`);
    if (seen.has(number)) throw new MoneyError(`Bill ${number} is repeated`);
    seen.add(number);
    if (!isDay(b.date)) throw new MoneyError(`${n}: enter the bill date`);
    if (b.dueDate && !isDay(b.dueDate)) throw new MoneyError(`${n}: due date must be a date`);
    const paid = b.paid ?? 0;
    if (!isInt(b.amount, 1, 10_000_000_000)) throw new MoneyError(`${number}: amount must be more than ₹0`);
    if (!isInt(paid, 0, b.amount - 1)) throw new MoneyError(`${number}: paid must be less than the bill amount`);
    const due = b.dueDate || plusDays(b.date, s.creditDays);
    return { number, date: b.date, due, amount: b.amount, paid };
  });
  await lockSupplier(ctx, supplierId);
  const done = await ctx.tx.journalEntry.count({ where: { supplierId, kind: "OPENING", reversedBy: null } });
  if (done) throw new MoneyError(`${s.name} already has an opening balance`, 409);
  const occurredAt = new Date(Math.min(dayEnd(asOf).getTime() - 1000, Date.now()));
  const dues = rows.reduce((a, r) => a + r.amount - r.paid, 0);
  if (dues > 0) {
    const e = await post(ctx, {
      kind: "OPENING",
      memo: `Opening balance: ${rows.length} bill${rows.length === 1 ? "" : "s"} of ${s.name} from the old books`,
      supplierId,
      occurredAt,
      lines: [
        { account: { type: "OPENING_EQUITY" }, amount: dues },
        { account: { type: "PAYABLE", supplierId }, amount: -dues },
      ],
    });
    for (const r of rows) {
      await ctx.tx.supplierBill.create({
        data: { tenantId: ctx.tenantId, supplierId, kind: "OPENING", number: r.number, date: new Date(`${r.date}T00:00:00Z`), dueDate: new Date(`${r.due}T00:00:00Z`), amount: r.amount, paid: r.paid, entryId: e.id, note: r.paid ? `₹${(r.paid / 100).toFixed(2)} paid in the old books` : "Opening bill" },
      });
    }
  }
  if (advance > 0) {
    const e = await post(ctx, {
      kind: "OPENING",
      memo: `Opening advance paid to ${s.name}`,
      supplierId,
      occurredAt,
      lines: [
        { account: { type: "PAYABLE", supplierId }, amount: advance },
        { account: { type: "OPENING_EQUITY" }, amount: -advance },
      ],
    });
    await ctx.tx.supplierCredit.create({ data: { tenantId: ctx.tenantId, supplierId, kind: "OPENING_ADVANCE", number: "OPENING", date: occurredAt, amount: advance, entryId: e.id, note: "Advance from the old books" } });
  }
  await allocateSupplier(ctx, supplierId);
  return { bills: rows.length, dues, advance };
}

// ───────────────────────────── reading ─────────────────────────────

export type SupplierRow = {
  id: string;
  name: string;
  kind: SupplierKind;
  gstin: string | null;
  phone: string | null;
  creditDays: number;
  active: boolean;
  /** What we owe them (credit balance as a positive number; negative = they owe us). */
  owed: number;
  openBills: number;
  overdue: number;
  unused: number;
};

/** Every supplier with what we owe them, open bills and how much is past due. */
export async function supplierSummary(ctx: Ctx, opts: { includeInactive?: boolean } = {}): Promise<SupplierRow[]> {
  const today = new Date(`${todayIst()}T00:00:00Z`);
  const [suppliers, accounts, bills, credits] = await Promise.all([
    ctx.tx.supplier.findMany({ where: opts.includeInactive ? {} : { active: true }, orderBy: { name: "asc" } }),
    ctx.tx.ledgerAccount.findMany({ where: { type: "PAYABLE" }, select: { id: true, supplierId: true } }),
    ctx.tx.supplierBill.findMany({ where: { settled: false }, select: { supplierId: true, amount: true, paid: true, dueDate: true } }),
    ctx.tx.supplierCredit.findMany({ select: { supplierId: true, amount: true, allocated: true } }),
  ]);
  const sums = accounts.length ? await ctx.tx.ledgerLine.groupBy({ by: ["accountId"], where: { accountId: { in: accounts.map((a) => a.id) } }, _sum: { amount: true } }) : [];
  const byAcc = new Map(sums.map((x) => [x.accountId, Number(x._sum.amount ?? 0)]));
  const owed = new Map<string, number>();
  for (const a of accounts) if (a.supplierId) owed.set(a.supplierId, (owed.get(a.supplierId) ?? 0) - (byAcc.get(a.id) ?? 0));
  return suppliers.map((s) => {
    const open = bills.filter((b) => b.supplierId === s.id);
    return {
      id: s.id,
      name: s.name,
      kind: s.kind,
      gstin: s.gstin,
      phone: s.phone,
      creditDays: s.creditDays,
      active: s.active,
      owed: owed.get(s.id) ?? 0,
      openBills: open.length,
      overdue: open.filter((b) => b.dueDate < today).reduce((a, b) => a + b.amount - b.paid, 0),
      unused: credits.filter((c) => c.supplierId === s.id).reduce((a, c) => a + c.amount - c.allocated, 0),
    };
  });
}

/** Purchase register: bills and notes of a period, with totals and a GST-rate summary. */
export async function purchaseRegister(ctx: Ctx, from: string, to: string, f: { supplierId?: string | null; type?: PurchaseDocType | null } = {}) {
  const docs = await ctx.tx.purchaseBill.findMany({
    where: { date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) }, ...(f.supplierId ? { supplierId: f.supplierId } : {}), ...(f.type ? { type: f.type } : {}) },
    include: { supplier: { select: { name: true, gstin: true } }, lines: { select: { gstRate: true, taxable: true, cgst: true, sgst: true, igst: true } } },
    orderBy: [{ date: "asc" }, { number: "asc" }],
    take: 3000,
  });
  const live = docs.filter((d) => !d.cancelledAt);
  const sign = (t: PurchaseDocType) => (t === "BILL" ? 1 : -1);
  const totals = { taxable: 0, cgst: 0, sgst: 0, igst: 0, itcTax: 0, total: 0 };
  const rates = new Map<number, { taxable: number; tax: number }>();
  for (const d of live) {
    const k = sign(d.type);
    totals.taxable += k * d.taxable;
    totals.cgst += k * d.cgst;
    totals.sgst += k * d.sgst;
    totals.igst += k * d.igst;
    totals.itcTax += k * d.itcTax;
    totals.total += k * d.total;
    for (const l of d.lines) {
      const r = rates.get(l.gstRate) ?? { taxable: 0, tax: 0 };
      r.taxable += k * l.taxable;
      r.tax += k * (l.cgst + l.sgst + l.igst);
      rates.set(l.gstRate, r);
    }
  }
  return {
    from,
    to,
    docs: docs.map((d) => ({
      id: d.id,
      type: d.type,
      number: d.number,
      supplierRef: d.supplierRef,
      date: d.date.toISOString().slice(0, 10),
      supplier: d.supplier.name,
      supplierId: d.supplierId,
      gstin: d.supplier.gstin,
      taxable: d.taxable,
      cgst: d.cgst,
      sgst: d.sgst,
      igst: d.igst,
      itcTax: d.itcTax,
      total: d.total,
      reverseCharge: d.reverseCharge,
      cancelled: !!d.cancelledAt,
    })),
    totals,
    rates: [...rates.entries()].map(([rate, v]) => ({ rate, ...v })).sort((a, b) => a.rate - b.rate),
    capped: docs.length >= 3000,
  };
}

/** One supplier: details, open bills, unused notes and advances, and recent documents. */
export async function supplierDetail(ctx: Ctx, id: string) {
  const supplier = await ctx.tx.supplier.findUnique({ where: { id }, include: { _count: { select: { products: true } } } });
  if (!supplier) throw new MoneyError("Supplier not found", 404);
  const [row] = (await supplierSummary(ctx, { includeInactive: true })).filter((r) => r.id === id);
  const [bills, credits, docs, opening] = await Promise.all([
    ctx.tx.supplierBill.findMany({ where: { supplierId: id, settled: false }, orderBy: [{ dueDate: "asc" }, { date: "asc" }], take: 500 }),
    ctx.tx.supplierCredit.findMany({ where: { supplierId: id }, orderBy: { date: "asc" }, take: 500 }),
    ctx.tx.purchaseBill.findMany({ where: { supplierId: id }, orderBy: [{ date: "desc" }, { number: "desc" }], take: 50, select: { id: true, type: true, number: true, supplierRef: true, date: true, total: true, cancelledAt: true } }),
    ctx.tx.journalEntry.count({ where: { supplierId: id, kind: "OPENING", reversedBy: null } }),
  ]);
  const today = todayIst();
  return {
    supplier,
    summary: row,
    hasOpening: opening > 0,
    account: `PAYABLE:${id}`,
    bills: bills.map((b) => ({ id: b.id, kind: b.kind, number: b.number, date: b.date.toISOString().slice(0, 10), dueDate: b.dueDate.toISOString().slice(0, 10), amount: b.amount, paid: b.paid, left: b.amount - b.paid, overdue: b.dueDate.toISOString().slice(0, 10) < today, purchaseBillId: b.purchaseBillId })),
    credits: credits.filter((c) => c.allocated < c.amount).map((c) => ({ id: c.id, kind: c.kind, number: c.number, date: c.date.toISOString().slice(0, 10), amount: c.amount, left: c.amount - c.allocated, purchaseBillId: c.purchaseBillId })),
    docs: docs.map((d) => ({ ...d, date: d.date.toISOString().slice(0, 10), cancelled: !!d.cancelledAt })),
  };
}

/** One bill or note with its lines, what it is against, and how much of it is paid. */
export async function purchaseDetail(ctx: Ctx, id: string) {
  const doc = await ctx.tx.purchaseBill.findUnique({
    where: { id },
    include: {
      supplier: { select: { id: true, name: true, gstin: true, stateCode: true } },
      lines: { orderBy: { id: "asc" } },
      against: { select: { id: true, number: true, supplierRef: true } },
      notes: { select: { id: true, type: true, number: true, total: true, cancelledAt: true } },
      purchase: { select: { id: true, number: true } },
    },
  });
  if (!doc) throw new MoneyError("Not found", 404);
  const open = doc.type === "BILL" ? await ctx.tx.supplierBill.findUnique({ where: { purchaseBillId: id } }) : await ctx.tx.supplierCredit.findUnique({ where: { purchaseBillId: id } });
  const done = open ? ("paid" in open ? open.paid : open.allocated) : 0;
  return { ...doc, date: doc.date.toISOString().slice(0, 10), dueDate: doc.dueDate?.toISOString().slice(0, 10) ?? null, settledAmount: done, label: DOC_LABEL[doc.type] };
}

/** What the purchase form needs: suppliers, products, heads, whether stock is tracked, and goods received not yet billed. */
export async function purchaseOptions(ctx: Ctx) {
  const [tenant, suppliers, products, heads, stock, grns] = await Promise.all([
    ctx.tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { stateCode: true } }),
    ctx.tx.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, kind: true, gstin: true, stateCode: true, creditDays: true } }),
    ctx.tx.product.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, sku: true, hsnCode: true, gstRate: true, lastCost: true, trackExpiry: true, supplierId: true, unit: true } }),
    ctx.tx.ledgerHead.findMany({ where: { active: true, group: { in: PURCHASE_HEAD_GROUPS } }, orderBy: [{ group: "asc" }, { name: "asc" }], select: { id: true, name: true, group: true } }),
    stockOn(ctx),
    ctx.tx.purchase.findMany({
      where: { bill: null },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, number: true, supplierId: true, billNo: true, billDate: true, createdAt: true, lines: { select: { id: true, productId: true, quantity: true, unitCost: true, batch: true, expiry: true } } },
    }),
  ]);
  return {
    stateCode: tenant.stateCode,
    suppliers,
    products,
    heads,
    stockOn: !!stock,
    grns: grns.map((g) => ({ ...g, billDate: g.billDate?.toISOString().slice(0, 10) ?? null, lines: g.lines.map((l) => ({ ...l, expiry: l.expiry?.toISOString().slice(0, 10) ?? null })) })),
    gstRates: GST_RATES,
  };
}
