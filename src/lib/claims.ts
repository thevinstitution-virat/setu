import type { ClaimStatus, ClaimType } from "@/generated/prisma/client";
import { MoneyError, post, reverseEntry, type AccountRef, type Ctx } from "@/lib/ledger";
import { docNumber, fyCode } from "@/lib/gst";
import { nextSequence } from "@/lib/orders";
import { dayEnd, dayStart, isDay, showDay, todayIst } from "@/lib/books";
import { CLAIM_STATUS_LABEL, CLAIM_TYPE_LABEL, claimAge, claimStatus, isClaimType, type ClaimAge } from "@/lib/claim-labels";

/**
 * Claims on companies (A4): money a company owes us for schemes we gave on
 * its products, goods that went bad, rate cuts on stock we held, and so on.
 *
 *   Raise:      Dr Claims receivable (company)   Cr Claims income
 *   Credit note against it (A2.4): Dr Supplier   Cr Claims receivable (+ GST input)
 *   Money in:   Dr Bank / Office cash             Cr Claims receivable
 *   Write off:  Dr Claims income                  Cr Claims receivable
 *
 * The claim keeps what came in (settled) and what was given up (writtenOff);
 * its status follows from those (claimStatus). Settlements are reversed,
 * never edited.
 */

export { CLAIM_STATUS_LABEL, CLAIM_TYPE_LABEL, SETTLE_KIND_LABEL, CLAIM_AGE_LABEL } from "@/lib/claim-labels";

export type ClaimLineInput = {
  productId?: string | null;
  description: string;
  quantity: number;
  /** Paise per unit. */
  rate: number;
  evidence?: string | null;
};

export type ClaimInput = {
  supplierId: string;
  type: ClaimType;
  /** The day it is raised. */
  date: string;
  periodFrom?: string | null;
  periodTo?: string | null;
  reference?: string | null;
  note?: string | null;
  lines: ClaimLineInput[];
};

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");
const isPaise = (v: unknown, min: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= 100_000_000_000;
const atDay = (day: string) => {
  const t = new Date(`${day}T12:00:00+05:30`);
  return t > new Date() ? new Date() : t;
};
const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const receivable = (supplierId: string): AccountRef => ({ type: "CLAIMS_RECEIVABLE", supplierId });

/** Same lock as purchases and payments: one company's claims, notes and payments go one at a time. */
async function lockCompany(ctx: Ctx, supplierId: string) {
  await ctx.tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${ctx.tenantId}:supplier:${supplierId}`}))`;
}

async function company(ctx: Ctx, id: string) {
  const s = await ctx.tx.supplier.findUnique({ where: { id: String(id) } });
  if (!s) throw new MoneyError("Company not found", 404);
  if (s.kind !== "GOODS") throw new MoneyError(`${s.name} is not a company whose goods we sell`);
  return s;
}

/** Re-add a claim's live settlements and set its status. */
async function refreshClaim(ctx: Ctx, claimId: string) {
  const c = await ctx.tx.claim.findUniqueOrThrow({ where: { id: claimId }, include: { settlements: { where: { reversedAt: null } } } });
  const settled = c.settlements.filter((s) => s.kind !== "WRITE_OFF").reduce((a, s) => a + s.amount, 0);
  const writtenOff = c.settlements.filter((s) => s.kind === "WRITE_OFF").reduce((a, s) => a + s.amount, 0);
  if (settled + writtenOff > c.amount) throw new MoneyError(`${c.number} would be settled for more than it claims`, 409);
  return ctx.tx.claim.update({ where: { id: c.id }, data: { settled, writtenOff, status: claimStatus(c.amount, settled, writtenOff), ...(writtenOff ? {} : { closeReason: null }) } });
}

const openOf = (c: { amount: number; settled: number; writtenOff: number }) => c.amount - c.settled - c.writtenOff;

async function liveClaim(ctx: Ctx, id: string) {
  const c = await ctx.tx.claim.findUnique({ where: { id: String(id) }, include: { supplier: { select: { name: true } } } });
  if (!c) throw new MoneyError("Claim not found", 404);
  if (c.cancelledAt) throw new MoneyError(`${c.number} was cancelled`, 409);
  return c;
}

// ───────────────────────────── raising ─────────────────────────────

/** Raise a claim: the document, its lines and Dr Claims receivable / Cr Claims income. */
export async function raiseClaim(ctx: Ctx, input: ClaimInput) {
  const s = await company(ctx, input.supplierId);
  if (!s.active) throw new MoneyError(`${s.name} is not in use`);
  await lockCompany(ctx, s.id);
  if (!isClaimType(input.type)) throw new MoneyError("Pick what the claim is for");
  if (!isDay(input.date)) throw new MoneyError("Enter the claim date");
  if (input.date > todayIst()) throw new MoneyError("The claim date is in the future");
  const from = input.periodFrom || null;
  const to = input.type === "RATE_DIFF" ? from : input.periodTo || from;
  if (from && !isDay(from)) throw new MoneyError("The period must be dates");
  if (to && !isDay(to)) throw new MoneyError("The period must be dates");
  if (input.type === "RATE_DIFF" && !from) throw new MoneyError("Enter the day the rate was cut");
  if (from && to && from > to) throw new MoneyError("The period ends before it starts");
  if (to && to > input.date) throw new MoneyError("The period ends after the claim date");

  if (!Array.isArray(input.lines) || !input.lines.length || input.lines.length > 500) throw new MoneyError("Add 1 to 500 lines");
  const lines = [];
  for (const [i, raw] of input.lines.entries()) {
    const n = `Line ${i + 1}`;
    const quantity = Number(raw.quantity);
    const rate = Number(raw.rate);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10_000_000) throw new MoneyError(`${n}: quantity must be a whole number, 1 or more`);
    if (!isPaise(rate, 1)) throw new MoneyError(`${n}: enter the rate`);
    const amount = quantity * rate;
    if (amount > 100_000_000_000) throw new MoneyError(`${n}: the amount is too large`);
    let productId: string | null = null;
    let description = text(raw.description, 160);
    if (raw.productId) {
      const p = await ctx.tx.product.findUnique({ where: { id: String(raw.productId) }, select: { id: true, name: true } });
      if (!p) throw new MoneyError(`${n}: product not found`);
      productId = p.id;
      description ||= p.name;
    }
    if (!description) throw new MoneyError(`${n}: say what it is for`);
    lines.push({ sl: i + 1, productId, description, quantity, rate, amount, evidence: text(raw.evidence, 200) || null });
  }
  const amount = lines.reduce((a, l) => a + l.amount, 0);
  if (amount > 100_000_000_000) throw new MoneyError("The claim is too large");

  const fy = fyCode(dayStart(input.date));
  const number = docNumber("CL", fy, await nextSequence(ctx.tx, ctx.tenantId, `cl:${fy}`));
  const claim = await ctx.tx.claim.create({
    data: {
      tenantId: ctx.tenantId,
      number,
      supplierId: s.id,
      type: input.type,
      date: new Date(`${input.date}T00:00:00Z`),
      periodFrom: from ? new Date(`${from}T00:00:00Z`) : null,
      periodTo: to ? new Date(`${to}T00:00:00Z`) : null,
      reference: text(input.reference, 80) || null,
      note: text(input.note, 500) || null,
      amount,
      createdById: ctx.actorId,
      lines: { create: lines.map((l) => ({ tenantId: ctx.tenantId, ...l })) },
    },
  });
  const entry = await post(ctx, {
    kind: "CLAIM_RAISE",
    memo: `Claim ${number} on ${s.name} · ${CLAIM_TYPE_LABEL[input.type]}${claim.reference ? ` · ${claim.reference}` : ""}`,
    supplierId: s.id,
    occurredAt: atDay(input.date),
    lines: [
      { account: receivable(s.id), amount },
      { account: { type: "CLAIM_INCOME" }, amount: -amount },
    ],
  });
  return ctx.tx.claim.update({ where: { id: claim.id }, data: { entryId: entry.id } });
}

/** Undo a claim raised by mistake. Only while nothing has come in or been written off against it. */
export async function cancelClaim(ctx: Ctx, id: string, reason: string) {
  const c = await liveClaim(ctx, id);
  await lockCompany(ctx, c.supplierId);
  const why = text(reason, 200);
  if (why.length < 3) throw new MoneyError("Say why it is cancelled");
  const live = await ctx.tx.claimSettlement.count({ where: { claimId: c.id, reversedAt: null } });
  if (live) throw new MoneyError("Something has already come in or been written off against this claim. Undo that first.", 409);
  if (c.entryId) await reverseEntry(ctx, c.entryId, `Claim ${c.number} cancelled: ${why}`);
  return ctx.tx.claim.update({ where: { id: c.id }, data: { cancelledAt: new Date(), cancelReason: why } });
}

// ───────────────────────────── settling ─────────────────────────────

export type ReceiptInput = { date: string; amount: number; bankAccountId?: string | null; cash?: boolean; reference?: string | null; note?: string | null };

/** The company paid us against a claim: Dr Bank (or Office cash), Cr Claims receivable. */
export async function receiveOnClaim(ctx: Ctx, id: string, input: ReceiptInput) {
  const c = await liveClaim(ctx, id);
  await lockCompany(ctx, c.supplierId);
  const fresh = await ctx.tx.claim.findUniqueOrThrow({ where: { id: c.id } });
  if (!isDay(input.date)) throw new MoneyError("Enter the day the money came");
  if (input.date > todayIst()) throw new MoneyError("That day is in the future");
  if (input.date < ymd(c.date)!) throw new MoneyError("The money came before the claim was raised");
  if (!isPaise(input.amount, 1)) throw new MoneyError("Enter the amount received");
  const open = openOf(fresh);
  if (input.amount > open) throw new MoneyError(`Only ${(open / 100).toFixed(2)} is still open on ${c.number}`);
  let bank = null;
  if (!input.cash) {
    bank = input.bankAccountId ? await ctx.tx.bankAccount.findUnique({ where: { id: input.bankAccountId } }) : await ctx.tx.bankAccount.findFirst({ where: { isDefault: true } });
    if (!bank) throw new MoneyError(input.bankAccountId ? "Bank account not found" : "Add a bank account first (Books → Bank accounts)", input.bankAccountId ? 404 : 400);
    if (!bank.active) throw new MoneyError(`${bank.name} is closed`);
  }
  const reference = text(input.reference, 60) || null;
  const entry = await post(ctx, {
    kind: "CLAIM_RECEIPT",
    memo: `From ${c.supplier.name} against claim ${c.number}${bank ? ` into ${bank.name}` : " in cash"}${reference ? ` · ${reference}` : ""}`,
    supplierId: c.supplierId,
    occurredAt: atDay(input.date),
    lines: [
      { account: bank ? { type: "BANK", bankAccountId: bank.id } : { type: "OFFICE_CASH" }, amount: input.amount },
      { account: receivable(c.supplierId), amount: -input.amount },
    ],
  });
  const st = await ctx.tx.claimSettlement.create({
    data: {
      tenantId: ctx.tenantId,
      claimId: c.id,
      kind: "RECEIPT",
      date: new Date(`${input.date}T00:00:00Z`),
      amount: input.amount,
      bankAccountId: bank?.id ?? null,
      cash: !bank,
      reference,
      note: text(input.note, 300) || null,
      entryId: entry.id,
      createdById: ctx.actorId,
    },
  });
  await refreshClaim(ctx, c.id);
  return st;
}

/** Give up what is still open (or part of it): rejected by the company, or not worth chasing. Dr Claims income, Cr Claims receivable. */
export async function writeOffClaim(ctx: Ctx, id: string, input: { date: string; reason: string; amount?: number | null }) {
  const c = await liveClaim(ctx, id);
  await lockCompany(ctx, c.supplierId);
  const fresh = await ctx.tx.claim.findUniqueOrThrow({ where: { id: c.id } });
  const open = openOf(fresh);
  if (open <= 0) throw new MoneyError("Nothing is open on this claim", 409);
  const why = text(input.reason, 200);
  if (why.length < 3) throw new MoneyError("Say why it is written off");
  if (!isDay(input.date) || input.date > todayIst()) throw new MoneyError("Pick the day");
  if (input.date < ymd(c.date)!) throw new MoneyError("That is before the claim was raised");
  const amount = input.amount == null || String(input.amount) === "" ? open : Number(input.amount);
  if (!isPaise(amount, 1) || amount > open) throw new MoneyError(`Write off up to ${(open / 100).toFixed(2)}`);
  const entry = await post(ctx, {
    kind: "CLAIM_WRITE_OFF",
    memo: `Claim ${c.number} on ${c.supplier.name}: written off · ${why}`,
    supplierId: c.supplierId,
    occurredAt: atDay(input.date),
    lines: [
      { account: { type: "CLAIM_INCOME" }, amount },
      { account: receivable(c.supplierId), amount: -amount },
    ],
  });
  await ctx.tx.claimSettlement.create({
    data: { tenantId: ctx.tenantId, claimId: c.id, kind: "WRITE_OFF", date: new Date(`${input.date}T00:00:00Z`), amount, note: why, entryId: entry.id, createdById: ctx.actorId },
  });
  await ctx.tx.claim.update({ where: { id: c.id }, data: { closeReason: why } });
  return refreshClaim(ctx, c.id);
}

/** Undo money received or a write-off entered by mistake. A credit note is undone by cancelling the note. */
export async function reverseSettlement(ctx: Ctx, settlementId: string, reason: string) {
  const st = await ctx.tx.claimSettlement.findUnique({ where: { id: settlementId }, include: { claim: true } });
  if (!st) throw new MoneyError("Not found", 404);
  if (st.reversedAt) throw new MoneyError("Already undone", 409);
  if (st.kind === "CREDIT_NOTE") throw new MoneyError("Cancel the credit note instead", 409);
  const why = text(reason, 200);
  if (why.length < 3) throw new MoneyError("Say why");
  await lockCompany(ctx, st.claim.supplierId);
  if (st.entryId) await reverseEntry(ctx, st.entryId, `Claim ${st.claim.number}: ${st.kind === "RECEIPT" ? "money received" : "write-off"} undone · ${why}`);
  await ctx.tx.claimSettlement.update({ where: { id: st.id }, data: { reversedAt: new Date(), note: [st.note, `Undone: ${why}`].filter(Boolean).join(" · ") } });
  return refreshClaim(ctx, st.claimId);
}

/**
 * For purchases.ts: a credit note's CLAIM lines that name a claim. Checks
 * each claim is the company's, live and has room; returns totals per claim.
 */
export async function checkClaimLines(ctx: Ctx, supplierId: string, wants: { claimId: string; amount: number }[]) {
  const per = new Map<string, number>();
  for (const w of wants) per.set(w.claimId, (per.get(w.claimId) ?? 0) + w.amount);
  for (const [claimId, amount] of per) {
    const c = await ctx.tx.claim.findUnique({ where: { id: claimId } });
    if (!c || c.supplierId !== supplierId) throw new MoneyError("A claim on the note is not this company's");
    if (c.cancelledAt) throw new MoneyError(`${c.number} was cancelled`, 409);
    const open = openOf(c);
    if (amount > open) throw new MoneyError(`${c.number} has only ${(open / 100).toFixed(2)} open; the note puts ${(amount / 100).toFixed(2)} against it`);
  }
  return per;
}

/** For purchases.ts: the credit note was saved; record what it settles. */
export async function settleByCreditNote(ctx: Ctx, note: { id: string; date: string }, per: Map<string, number>, ref: string) {
  for (const [claimId, amount] of per) {
    await ctx.tx.claimSettlement.create({
      data: { tenantId: ctx.tenantId, claimId, kind: "CREDIT_NOTE", date: new Date(`${note.date}T00:00:00Z`), amount, purchaseBillId: note.id, reference: ref, createdById: ctx.actorId },
    });
    await refreshClaim(ctx, claimId);
  }
}

/** For purchases.ts: the credit note was cancelled; its claims are open again. */
export async function unsettleCreditNote(ctx: Ctx, purchaseBillId: string) {
  const sts = await ctx.tx.claimSettlement.findMany({ where: { purchaseBillId, reversedAt: null } });
  for (const st of sts) {
    await ctx.tx.claimSettlement.update({ where: { id: st.id }, data: { reversedAt: new Date(), note: "Credit note cancelled" } });
    await refreshClaim(ctx, st.claimId);
  }
}

// ───────────────────────────── reading ─────────────────────────────

export type ClaimFilter = { status?: "open" | "closed" | ClaimStatus | null; supplierId?: string | null; type?: ClaimType | null; from?: string | null; to?: string | null };

export async function claimsList(ctx: Ctx, f: ClaimFilter = {}) {
  const status =
    f.status === "open"
      ? { in: ["RAISED", "PART_SETTLED"] as ClaimStatus[] }
      : f.status === "closed"
        ? { in: ["SETTLED", "REJECTED", "WRITTEN_OFF"] as ClaimStatus[] }
        : f.status && f.status in CLAIM_STATUS_LABEL
          ? f.status
          : undefined;
  const rows = await ctx.tx.claim.findMany({
    where: {
      cancelledAt: f.status ? null : undefined,
      status,
      supplierId: f.supplierId || undefined,
      type: f.type || undefined,
      date: f.from || f.to ? { gte: f.from ? new Date(`${f.from}T00:00:00Z`) : undefined, lte: f.to ? new Date(`${f.to}T00:00:00Z`) : undefined } : undefined,
    },
    orderBy: [{ date: "desc" }, { number: "desc" }],
    take: 500,
    include: { supplier: { select: { name: true } } },
  });
  const today = todayIst();
  return rows.map((c) => ({
    id: c.id,
    number: c.number,
    supplierId: c.supplierId,
    company: c.supplier.name,
    type: c.type,
    date: ymd(c.date)!,
    periodFrom: ymd(c.periodFrom),
    periodTo: ymd(c.periodTo),
    reference: c.reference,
    amount: c.amount,
    settled: c.settled,
    writtenOff: c.writtenOff,
    open: c.cancelledAt ? 0 : openOf(c),
    status: c.status,
    cancelled: !!c.cancelledAt,
    age: daysBetween(ymd(c.date)!, today),
  }));
}

export async function claimDetail(ctx: Ctx, id: string) {
  const c = await ctx.tx.claim.findUnique({
    where: { id },
    include: {
      supplier: { select: { id: true, name: true, gstin: true, address: true, contactName: true, phone: true, email: true } },
      lines: { orderBy: { sl: "asc" } },
      settlements: { orderBy: [{ date: "asc" }, { createdAt: "asc" }], include: { bankAccount: { select: { name: true } } } },
    },
  });
  if (!c) throw new MoneyError("Claim not found", 404);
  const notes = await ctx.tx.purchaseBill.findMany({
    where: { id: { in: c.settlements.map((s) => s.purchaseBillId).filter((x): x is string => !!x) } },
    select: { id: true, number: true, supplierRef: true },
  });
  return {
    ...c,
    open: c.cancelledAt ? 0 : openOf(c),
    settlements: c.settlements.map((s) => ({ ...s, note: s.note, creditNote: notes.find((n) => n.id === s.purchaseBillId) ?? null })),
  };
}

/** Open claims of one company, for a credit note's claim lines. */
export async function openClaimsFor(ctx: Ctx, supplierId: string) {
  const rows = await ctx.tx.claim.findMany({ where: { supplierId, cancelledAt: null, status: { in: ["RAISED", "PART_SETTLED"] } }, orderBy: { date: "asc" } });
  return rows.map((c) => ({ id: c.id, number: c.number, type: c.type, date: ymd(c.date)!, reference: c.reference, amount: c.amount, open: openOf(c) }));
}

/** Companies (goods suppliers) and banks for the claim forms. */
export async function claimOptions(ctx: Ctx) {
  const [companies, banks] = await Promise.all([
    ctx.tx.supplier.findMany({ where: { kind: "GOODS", active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, gstin: true } }),
    ctx.tx.bankAccount.findMany({ where: { active: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, name: true, isDefault: true } }),
  ]);
  return { companies, banks };
}

// ───────────────────────────── claim basis (A4.2) ─────────────────────────────

export type BasisLine = { productId: string | null; description: string; quantity: number; rate: number; evidence: string | null };
export type StockOnDay = { productId: string; name: string; qty: number; cost: number | null };

/** Stock that can be sold (warehouses and vans) at the end of a day, per product. */
async function sellableOn(ctx: Ctx, productIds: string[], day: string) {
  const places = (await ctx.tx.stockLocation.findMany({ where: { kind: { in: ["WAREHOUSE", "VAN"] } }, select: { id: true } })).map((p) => p.id);
  const S = new Set(places);
  const qty = new Map<string, number>(productIds.map((id) => [id, 0]));
  const lots = await ctx.tx.stockLot.groupBy({ by: ["productId"], where: { productId: { in: productIds }, locationId: { in: places } }, _sum: { qty: true } });
  for (const l of lots) qty.set(l.productId, l._sum.qty ?? 0);
  // Take back every move after that day.
  const later = await ctx.tx.stockMove.findMany({ where: { productId: { in: productIds }, createdAt: { gt: dayEnd(day) } }, select: { productId: true, qty: true, fromId: true, toId: true } });
  for (const m of later) {
    const d = (m.toId && S.has(m.toId) ? m.qty : 0) - (m.fromId && S.has(m.fromId) ? m.qty : 0);
    qty.set(m.productId, (qty.get(m.productId) ?? 0) - d);
  }
  return qty;
}

/**
 * What the app's own records say a claim could hold, for the accountant to
 * check and edit before raising it.
 *  - SCHEME: free goods (at our cost) and scheme discounts on the company's products billed in the period, less goods returned or bills cancelled.
 *  - DAMAGE: goods of theirs that came back damaged / expired or were moved to the damaged bin in the period, at cost.
 *  - RATE_DIFF: no lines; their products with our stock at the end of that day and our last cost, for the rates to be entered.
 */
export async function claimBasis(ctx: Ctx, input: { supplierId: string; type: ClaimType; from: string; to?: string | null }) {
  const s = await company(ctx, input.supplierId);
  if (!isClaimType(input.type)) throw new MoneyError("Pick what the claim is for");
  const from = input.from;
  const to = input.type === "RATE_DIFF" ? from : input.to || from;
  if (!isDay(from) || !isDay(to) || from > to) throw new MoneyError("Pick the period");
  if (to > todayIst()) throw new MoneyError("The period runs into the future");
  const products = await ctx.tx.product.findMany({ where: { supplierId: s.id }, select: { id: true, name: true, lastCost: true } });
  const pIds = products.map((p) => p.id);
  const pName = new Map(products.map((p) => [p.id, p.name]));
  const pCost = new Map(products.map((p) => [p.id, p.lastCost]));
  const lines: BasisLine[] = [];
  const noCost = new Set<string>();
  let stock: StockOnDay[] = [];

  if (input.type === "SCHEME" && pIds.length) {
    const inv = await ctx.tx.invoiceLine.findMany({
      where: {
        productId: { in: pIds },
        invoice: {
          date: { gte: dayStart(from), lte: dayEnd(to) },
          OR: [{ type: { in: ["TAX_INVOICE", "BILL_OF_SUPPLY"] } }, { type: "CREDIT_NOTE", noteKind: { in: ["return", "cancel"] } }],
        },
        OR: [{ discount: { gt: 0 } }, { freeQty: { gt: 0 } }],
      },
      select: { productId: true, orderItemId: true, quantity: true, freeQty: true, discount: true, invoice: { select: { type: true, number: true } } },
    });
    // Cost of free goods: what the sale took out of stock, else the last cost.
    const itemIds = inv.filter((l) => l.freeQty > 0 && l.orderItemId).map((l) => l.orderItemId!);
    const sold = itemIds.length ? await ctx.tx.stockMove.findMany({ where: { kind: "SALE", orderItemId: { in: itemIds } }, select: { orderItemId: true, qty: true, unitCost: true } }) : [];
    const moveCost = new Map<string, { q: number; v: number }>();
    for (const m of sold) {
      if (m.unitCost == null) continue;
      const cur = moveCost.get(m.orderItemId!) ?? { q: 0, v: 0 };
      moveCost.set(m.orderItemId!, { q: cur.q + m.qty, v: cur.v + m.qty * m.unitCost });
    }
    const free = new Map<string, { qty: number; value: number; bills: Set<string> }>();
    const disc = new Map<string, { units: number; amount: number; bills: Set<string> }>();
    for (const l of inv) {
      const sign = l.invoice.type === "CREDIT_NOTE" ? -1 : 1;
      const pid = l.productId!;
      if (l.freeQty > 0) {
        const mc = l.orderItemId ? moveCost.get(l.orderItemId) : undefined;
        const unit = mc && mc.q ? Math.round(mc.v / mc.q) : pCost.get(pid);
        if (unit == null) noCost.add(pid);
        const cur = free.get(pid) ?? { qty: 0, value: 0, bills: new Set() };
        cur.qty += sign * l.freeQty;
        cur.value += sign * l.freeQty * (unit ?? 0);
        cur.bills.add(l.invoice.number);
        free.set(pid, cur);
      }
      if (l.discount > 0) {
        const cur = disc.get(pid) ?? { units: 0, amount: 0, bills: new Set() };
        cur.units += sign * l.quantity;
        cur.amount += sign * l.discount;
        cur.bills.add(l.invoice.number);
        disc.set(pid, cur);
      }
    }
    const bills = (b: Set<string>) => `${b.size} bill${b.size === 1 ? "" : "s"}: ${[...b].slice(0, 6).join(", ")}${b.size > 6 ? " …" : ""}`;
    for (const [pid, f] of free) {
      if (f.qty <= 0 || f.value <= 0) continue;
      lines.push({ productId: pid, description: `${pName.get(pid)} (free goods given)`, quantity: f.qty, rate: Math.round(f.value / f.qty), evidence: bills(f.bills) });
    }
    for (const [pid, d] of disc) {
      if (d.amount <= 0) continue;
      lines.push({ productId: pid, description: `${pName.get(pid)}: scheme discount on ${Math.max(d.units, 0).toLocaleString("en-IN")} units`, quantity: 1, rate: d.amount, evidence: bills(d.bills) });
    }
  }

  if (input.type === "DAMAGE" && pIds.length) {
    const moves = await ctx.tx.stockMove.findMany({
      where: {
        productId: { in: pIds },
        createdAt: { gte: dayStart(from), lte: dayEnd(to) },
        OR: [{ kind: "DAMAGE" }, { kind: "RETURN", reason: { in: ["damaged", "expired"] } }],
      },
      select: { productId: true, kind: true, qty: true, unitCost: true, reason: true },
    });
    const by = new Map<string, { productId: string; why: string; qty: number; value: number; costed: number }>();
    for (const m of moves) {
      const why = m.kind === "RETURN" ? `returned ${m.reason} by shops` : m.reason === "expired" ? "expired in our stock" : "damaged in our stock";
      const k = `${m.productId}|${why}`;
      const cur = by.get(k) ?? { productId: m.productId, why, qty: 0, value: 0, costed: 0 };
      const unit = m.unitCost ?? pCost.get(m.productId);
      if (unit == null) noCost.add(m.productId);
      cur.qty += m.qty;
      cur.value += m.qty * (unit ?? 0);
      by.set(k, cur);
    }
    for (const r of by.values()) {
      if (r.qty <= 0 || r.value <= 0) continue;
      lines.push({ productId: r.productId, description: `${pName.get(r.productId)} (${r.why})`, quantity: r.qty, rate: Math.round(r.value / r.qty), evidence: null });
    }
  }

  if (input.type === "RATE_DIFF" && pIds.length) {
    const q = await sellableOn(ctx, pIds, from);
    stock = products
      .map((p) => ({ productId: p.id, name: p.name, qty: q.get(p.id) ?? 0, cost: p.lastCost }))
      .filter((p) => p.qty > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  lines.sort((a, b) => a.description.localeCompare(b.description));
  // Claims of the same kind on this company that already cover part of the period.
  const overlaps = await ctx.tx.claim.findMany({
    where: { supplierId: s.id, type: input.type, cancelledAt: null, periodFrom: { lte: new Date(`${to}T00:00:00Z`) }, periodTo: { gte: new Date(`${from}T00:00:00Z`) } },
    select: { id: true, number: true, periodFrom: true, periodTo: true, amount: true },
  });
  return {
    company: { id: s.id, name: s.name },
    lines,
    stock,
    noCost: [...noCost].map((id) => pName.get(id) ?? id),
    products: products.length,
    overlaps: overlaps.map((o) => ({ id: o.id, number: o.number, from: ymd(o.periodFrom), to: ymd(o.periodTo), amount: o.amount })),
  };
}

// ───────────────────────────── reports (A4.4) ─────────────────────────────

/** Open claims as on a day, aged from the day each was raised, with a company-wise summary. */
export async function pendingClaims(ctx: Ctx, asOn: string, f: { supplierId?: string | null } = {}) {
  const rows = await ctx.tx.claim.findMany({
    where: { cancelledAt: null, date: { lte: new Date(`${asOn}T00:00:00Z`) }, supplierId: f.supplierId || undefined },
    include: { supplier: { select: { name: true } }, settlements: { where: { reversedAt: null, date: { lte: new Date(`${asOn}T00:00:00Z`) } }, select: { amount: true } } },
    orderBy: [{ date: "asc" }, { number: "asc" }],
  });
  const claims = rows
    .map((c) => {
      const done = c.settlements.reduce((a, s) => a + s.amount, 0);
      const age = daysBetween(ymd(c.date)!, asOn);
      return {
        id: c.id,
        number: c.number,
        supplierId: c.supplierId,
        company: c.supplier.name,
        type: c.type,
        date: ymd(c.date)!,
        periodFrom: ymd(c.periodFrom),
        periodTo: ymd(c.periodTo),
        reference: c.reference,
        amount: c.amount,
        done,
        open: c.amount - done,
        age,
        bucket: claimAge(age),
      };
    })
    .filter((c) => c.open > 0);
  type Co = { supplierId: string; company: string; claims: number; open: number } & Record<ClaimAge, number>;
  const by = new Map<string, Co>();
  for (const c of claims) {
    const cur = by.get(c.supplierId) ?? { supplierId: c.supplierId, company: c.company, claims: 0, open: 0, d30: 0, d60: 0, d90: 0, older: 0 };
    cur.claims += 1;
    cur.open += c.open;
    cur[c.bucket] += c.open;
    by.set(c.supplierId, cur);
  }
  const companies = [...by.values()].sort((a, b) => b.open - a.open);
  const sum = (k: "open" | ClaimAge) => companies.reduce((a, r) => a + r[k], 0);
  return { asOn, claims, companies, totals: { claims: claims.length, open: sum("open"), d30: sum("d30"), d60: sum("d60"), d90: sum("d90"), older: sum("older") } };
}

/** What came in (credit notes, money) and what was written off, in a period. */
export async function settlementsIn(ctx: Ctx, from: string, to: string, f: { supplierId?: string | null } = {}) {
  const rows = await ctx.tx.claimSettlement.findMany({
    where: { reversedAt: null, date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) }, claim: { supplierId: f.supplierId || undefined } },
    include: { claim: { select: { id: true, number: true, type: true, supplier: { select: { name: true } } } }, bankAccount: { select: { name: true } } },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });
  const notes = await ctx.tx.purchaseBill.findMany({ where: { id: { in: rows.map((r) => r.purchaseBillId).filter((x): x is string => !!x) } }, select: { id: true, number: true, supplierRef: true } });
  const list = rows.map((r) => {
    const cn = notes.find((n) => n.id === r.purchaseBillId);
    return {
      id: r.id,
      date: ymd(r.date)!,
      claimId: r.claim.id,
      claim: r.claim.number,
      type: r.claim.type,
      company: r.claim.supplier.name,
      kind: r.kind,
      amount: r.amount,
      how:
        r.kind === "CREDIT_NOTE"
          ? `Credit note ${cn?.supplierRef ?? ""} (${cn?.number ?? ""})`
          : r.kind === "RECEIPT"
            ? (r.cash ? "Office cash" : (r.bankAccount?.name ?? "Bank")) + (r.reference ? ` · ${r.reference}` : "")
            : (r.note ?? ""),
    };
  });
  const tot = (k: "CREDIT_NOTE" | "RECEIPT" | "WRITE_OFF") => list.filter((x) => x.kind === k).reduce((a, x) => a + x.amount, 0);
  return { from, to, rows: list, totals: { creditNotes: tot("CREDIT_NOTE"), received: tot("RECEIPT"), writtenOff: tot("WRITE_OFF") } };
}

/** Claims raised in a period, by type: claimed, received so far, written off, still open. */
export async function claimsByType(ctx: Ctx, from: string, to: string, f: { supplierId?: string | null } = {}) {
  const rows = await ctx.tx.claim.findMany({
    where: { cancelledAt: null, date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) }, supplierId: f.supplierId || undefined },
    select: { type: true, amount: true, settled: true, writtenOff: true },
  });
  const types = (Object.keys(CLAIM_TYPE_LABEL) as ClaimType[]).map((type) => {
    const mine = rows.filter((r) => r.type === type);
    const claimed = mine.reduce((a, r) => a + r.amount, 0);
    const received = mine.reduce((a, r) => a + r.settled, 0);
    const writtenOff = mine.reduce((a, r) => a + r.writtenOff, 0);
    return { type, claims: mine.length, claimed, received, writtenOff, open: claimed - received - writtenOff, pct: claimed ? Math.round((received / claimed) * 1000) / 10 : 0 };
  });
  const sum = (k: "claims" | "claimed" | "received" | "writtenOff" | "open") => types.reduce((a, t) => a + t[k], 0);
  const claimed = sum("claimed");
  return {
    from,
    to,
    types,
    totals: { claims: sum("claims"), claimed, received: sum("received"), writtenOff: sum("writtenOff"), open: sum("open"), pct: claimed ? Math.round((sum("received") / claimed) * 1000) / 10 : 0 },
  };
}

export const periodText = (c: { type: ClaimType; periodFrom: string | null; periodTo: string | null }) =>
  !c.periodFrom
    ? ""
    : c.type === "RATE_DIFF"
      ? `Rate cut on ${showDay(c.periodFrom)}`
      : c.periodFrom === c.periodTo || !c.periodTo
        ? showDay(c.periodFrom)
        : `${showDay(c.periodFrom)} to ${showDay(c.periodTo)}`;
