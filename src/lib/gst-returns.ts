import type { BankAccount } from "@/generated/prisma/client";
import { MoneyError, post, reverseEntry, type AccountRef, type Ctx, type Line } from "@/lib/ledger";
import { dayEnd, dayStart, isDay, showDay, todayIst } from "@/lib/books";
import { stateLabel } from "@/lib/gst";
import {
  addHeads,
  headsTotal,
  isPeriod,
  MATCH_SLACK,
  noHeads,
  numberKey,
  periodLabel,
  periodOf,
  periodRange,
  setOff,
  shiftPeriod,
  splitHeads,
  usedTotal,
  type Heads,
  type SetOff,
} from "@/lib/gst-math";
import type { Parsed2b } from "@/lib/gst-2b";

/**
 * GST on both sides (A8): the GSTR-3B working of a month from issued
 * documents, purchase bills, notes and expense vouchers; the input credit
 * register; the month's set-off and payment (posted to GST output, GST
 * input and a bank); and the GSTR-2B match.
 */

const LINE_MAX = 2_000_000_000;
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");
const lockGst = (ctx: Ctx) => ctx.tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${ctx.tenantId}:gst`}))`;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
/** Noon IST of a day, or now when that is still ahead. */
const atDay = (day: string) => {
  const t = new Date(`${day}T12:00:00+05:30`);
  return t > new Date() ? new Date() : t;
};

export type Amt = Heads & { taxable: number };
const noAmt = (): Amt => ({ taxable: 0, ...noHeads() });
const addAmt = (a: Amt, b: Amt, k = 1): Amt => ({ taxable: a.taxable + k * b.taxable, ...addHeads(a, b, k) });

// ───────────────────────────── inward documents ─────────────────────────────

export type InwardSrc = "BILL" | "DEBIT_NOTE" | "CREDIT_NOTE" | "VOUCHER";
export const INWARD_LABEL: Record<InwardSrc, string> = { BILL: "Bill", DEBIT_NOTE: "Our debit note", CREDIT_NOTE: "Their credit note", VOUCHER: "Expense voucher" };

type InLine = { rate: number | null; taxable: number; igst: number; cgst: number; sgst: number; itc: boolean };
export type Inward = {
  id: string;
  src: InwardSrc;
  date: string;
  number: string;
  ref: string;
  party: string;
  gstin: string | null;
  supplierId: string | null;
  rcm: boolean;
  interState: boolean;
  /** +1 for bills and vouchers, −1 for notes (they take credit back). */
  sign: number;
  lines: InLine[];
  href: string;
};

/** Purchase bills, notes and expense vouchers dated in a period (cancelled ones left out). */
async function inward(ctx: Ctx, from: string, to: string, stateCode: string | null): Promise<Inward[]> {
  const range = { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) };
  const [bills, vouchers] = await Promise.all([
    ctx.tx.purchaseBill.findMany({
      where: { date: range, cancelledAt: null },
      include: { lines: true, supplier: { select: { name: true, gstin: true } } },
      orderBy: [{ date: "asc" }, { number: "asc" }],
    }),
    ctx.tx.voucher.findMany({ where: { type: "PAYMENT", gst: { not: 0 }, date: range, cancelledAt: null }, include: { lines: true }, orderBy: [{ date: "asc" }, { number: "asc" }] }),
  ]);
  const out: Inward[] = bills.map((b) => ({
    id: b.id,
    src: b.type,
    date: ymd(b.date),
    number: b.number,
    ref: b.supplierRef,
    party: b.supplier.name,
    gstin: b.supplier.gstin,
    supplierId: b.supplierId,
    rcm: b.reverseCharge,
    interState: b.interState,
    sign: b.type === "BILL" ? 1 : -1,
    lines: b.lines.map((l) => ({ rate: l.gstRate, taxable: l.taxable, igst: l.igst, cgst: l.cgst, sgst: l.sgst, itc: l.itc })),
    href: `/admin/books/purchases/${b.id}`,
  }));
  for (const v of vouchers) {
    const gstin = v.partyGstin?.trim() || null;
    const inter = !!gstin && !!stateCode && gstin.slice(0, 2) !== stateCode;
    const taxable = v.lines.filter((l) => l.role === "ACCOUNT").reduce((a, l) => a + l.amount, 0);
    out.push({
      id: v.id,
      src: "VOUCHER",
      date: ymd(v.date),
      number: v.number,
      ref: v.reference ?? "",
      party: v.party ?? "",
      gstin,
      supplierId: null,
      rcm: false,
      interState: inter,
      sign: 1,
      lines: [{ rate: null, taxable, ...splitHeads(v.gst, inter), itc: true }],
      href: `/admin/books/vouchers/${v.id}`,
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number));
}

const lineAmt = (l: InLine, k: number): Amt => ({ taxable: k * l.taxable, igst: k * l.igst, cgst: k * l.cgst, sgst: k * l.sgst });

// ───────────────────────────── A8.2 GSTR-3B working ─────────────────────────────

export type Working = Awaited<ReturnType<typeof gstWorking>>;

/** The GSTR-3B working of a month: outward supplies, reverse charge, input credit and exempt inward supplies. */
export async function gstWorking(ctx: Ctx, period: string) {
  if (!isPeriod(period)) throw new MoneyError("Pick a month");
  const { from, to } = periodRange(period);
  const tenant = await ctx.tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { stateCode: true, gstin: true } });
  const [docs, ins, journals] = await Promise.all([
    ctx.tx.invoice.findMany({ where: { date: { gte: dayStart(from), lte: dayEnd(to) } }, include: { lines: { select: { gstRate: true, taxable: true, igst: true, cgst: true, sgst: true } } } }),
    inward(ctx, from, to, tenant.stateCode),
    ctx.tx.$queryRaw<{ t: string; amt: bigint }[]>`
      SELECT a.type::text t, COALESCE(SUM(l.amount), 0)::bigint amt
      FROM "LedgerLine" l JOIN "LedgerAccount" a ON a.id = l."accountId" JOIN "JournalEntry" e ON e.id = l."entryId"
      WHERE l."tenantId" = ${ctx.tenantId} AND a.type IN ('GST_INPUT', 'GST_OUTPUT') AND e.kind = 'JOURNAL'
        AND e."occurredAt" >= ${dayStart(from)} AND e."occurredAt" <= ${dayEnd(to)}
      GROUP BY 1`,
  ]);

  // 3.1 outward supplies and 3.2 inter-state supplies to unregistered persons.
  let taxed = noAmt();
  let nil = 0;
  const pos = new Map<string, { pos: string; label: string; taxable: number; igst: number }>();
  let invoices = 0;
  let notes = 0;
  for (const d of docs) {
    const k = d.type === "CREDIT_NOTE" ? -1 : 1;
    if (d.type === "TAX_INVOICE" || d.type === "BILL_OF_SUPPLY") invoices++;
    else notes++;
    for (const l of d.lines) {
      if (l.gstRate === 0 || d.type === "BILL_OF_SUPPLY") {
        nil += k * l.taxable;
        continue;
      }
      taxed = addAmt(taxed, { taxable: l.taxable, igst: l.igst, cgst: l.cgst, sgst: l.sgst }, k);
      if (!d.b2b && d.interState) {
        const p = pos.get(d.placeOfSupply) ?? { pos: d.placeOfSupply, label: stateLabel(d.placeOfSupply) || d.placeOfSupply, taxable: 0, igst: 0 };
        p.taxable += k * l.taxable;
        p.igst += k * l.igst;
        pos.set(d.placeOfSupply, p);
      }
    }
  }

  // 3.1(d) reverse charge, 4 input credit, 5 exempt inward.
  let rcmInward = noAmt();
  let itcRcm = noHeads();
  let itcBills = noHeads();
  let itcNotes = noHeads();
  let itcVouchers = noHeads();
  let ineligible = noHeads();
  const exemptIn = { inter: 0, intra: 0 };
  const counts = { invoices, notes, bills: 0, purchaseNotes: 0, vouchers: 0, rcmBills: 0 };
  for (const d of ins) {
    if (d.src === "VOUCHER") counts.vouchers++;
    else if (d.src === "BILL") counts.bills++;
    else counts.purchaseNotes++;
    if (d.rcm) counts.rcmBills++;
    for (const l of d.lines) {
      const a = lineAmt(l, d.sign);
      if (l.rate === 0) {
        exemptIn[d.interState ? "inter" : "intra"] += a.taxable;
        continue;
      }
      if (d.rcm) rcmInward = addAmt(rcmInward, a);
      if (!l.itc) ineligible = addHeads(ineligible, a);
      else if (d.rcm) itcRcm = addHeads(itcRcm, a);
      else if (d.src === "VOUCHER") itcVouchers = addHeads(itcVouchers, a);
      else if (d.src === "BILL") itcBills = addHeads(itcBills, a);
      else itcNotes = addHeads(itcNotes, a);
    }
  }
  const itcOther = addHeads(addHeads(itcBills, itcNotes), itcVouchers);
  const itcNet = addHeads(itcRcm, itcOther);

  const journal = { input: 0, output: 0 };
  for (const j of journals) journal[j.t === "GST_INPUT" ? "input" : "output"] = Number(j.amt);
  const warnings: string[] = [];
  if (journal.input || journal.output)
    warnings.push(
      `Journal vouchers this month moved GST input by ${rupee(journal.input)} and GST output by ${rupee(-journal.output)}. They are not in this working (a journal has no IGST / CGST / SGST split): check them.`,
    );
  for (const h of ["igst", "cgst", "sgst"] as const)
    if (taxed[h] < 0)
      warnings.push(
        `Credit notes this month take back more ${h.toUpperCase()} (${rupee(-taxed[h])}) than the bills charged; the return can't show less than zero, so carry it to next month's outward supplies.`,
      );
  if (!tenant.gstin) warnings.push("The business has no GSTIN in its settings.");

  return {
    period,
    label: periodLabel(period),
    from,
    to,
    gstin: tenant.gstin,
    /** 3.1(a) taxable outward supplies. */
    outward: taxed,
    /** 3.1(c) nil-rated and exempt. */
    nil,
    /** 3.1(d) inward supplies liable to reverse charge. */
    rcmInward,
    /** 3.2 inter-state supplies to unregistered persons, by place of supply. */
    interB2c: [...pos.values()].filter((p) => p.taxable || p.igst).sort((a, b) => a.pos.localeCompare(b.pos)),
    itc: { rcm: itcRcm, bills: itcBills, notes: itcNotes, vouchers: itcVouchers, other: itcOther, net: itcNet, ineligible },
    /** 5 exempt, nil-rated and non-GST inward supplies. */
    exemptIn,
    /** What is paid in 6.1: output tax (never below 0) and reverse charge. */
    liab: { igst: Math.max(0, taxed.igst), cgst: Math.max(0, taxed.cgst), sgst: Math.max(0, taxed.sgst) },
    rcm: { igst: rcmInward.igst, cgst: rcmInward.cgst, sgst: rcmInward.sgst },
    counts,
    journal,
    warnings,
  };
}

const rupee = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ───────────────────────────── A8.3 set-off and payment ─────────────────────────────

const heads = (s: { igst?: number; cgst?: number; sgst?: number } | null | undefined): Heads => ({ igst: s?.igst ?? 0, cgst: s?.cgst ?? 0, sgst: s?.sgst ?? 0 });
type Settlement = NonNullable<Awaited<ReturnType<Ctx["tx"]["gstSettlement"]["findFirst"]>>>;
const closeOf = (s: Settlement): Heads => ({ igst: s.closeIgst, cgst: s.closeCgst, sgst: s.closeSgst });
const openOf = (s: Settlement): Heads => ({ igst: s.openIgst, cgst: s.openCgst, sgst: s.openSgst });
const settledOff = (s: Settlement): SetOff => {
  const credit = addHeads(openOf(s), { igst: s.itcIgst, cgst: s.itcCgst, sgst: s.itcSgst });
  return setOff({ liab: { igst: s.liabIgst, cgst: s.liabCgst, sgst: s.liabSgst }, rcm: { igst: s.rcmIgst, cgst: s.rcmCgst, sgst: s.rcmSgst }, credit });
};

/** Where the credit brought into a month comes from: last month's settlement, or (the first month settled here) the portal's credit ledger. */
async function openingFor(ctx: Ctx, period: string) {
  const live = await ctx.tx.gstSettlement.findMany({ where: { cancelledAt: null }, orderBy: { period: "asc" } });
  const prev = live.find((s) => s.period === shiftPeriod(period, -1)) ?? null;
  const later = live.find((s) => s.period > period) ?? null;
  const earlier = [...live].reverse().find((s) => s.period < period) ?? null;
  let blocked: string | null = null;
  if (later) blocked = `${periodLabel(later.period)} is already settled. Months are settled in order: cancel the later ones first.`;
  else if (!prev && earlier) blocked = `Settle ${periodLabel(shiftPeriod(earlier.period, 1))} first: the credit carried into this month comes from it.`;
  return { prev, blocked, first: !live.length || (!prev && !earlier) };
}

/** The GST input account's balance at the end of a day. */
async function inputBalance(ctx: Ctx, day: string) {
  const r = await ctx.tx.$queryRaw<{ s: bigint }[]>`
    SELECT COALESCE(SUM(l.amount), 0)::bigint s FROM "LedgerLine" l JOIN "LedgerAccount" a ON a.id = l."accountId" JOIN "JournalEntry" e ON e.id = l."entryId"
    WHERE l."tenantId" = ${ctx.tenantId} AND a.type = 'GST_INPUT' AND e."occurredAt" <= ${dayEnd(day)}`;
  return Number(r[0]?.s ?? 0);
}

/** A month's GSTR-3B with its set-off: settled (as it was), or worked out with the credit brought forward. */
export async function gstMonth(ctx: Ctx, period: string, opening?: Heads | null) {
  const working = await gstWorking(ctx, period);
  const settled = await ctx.tx.gstSettlement.findFirst({ where: { period, cancelledAt: null }, include: { bankAccount: { select: { name: true } } } });
  const banks = await ctx.tx.bankAccount.findMany({ where: { active: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, name: true, isDefault: true } });
  const over = working.to < todayIst();
  if (settled) {
    const snap = settled.working as unknown as Working;
    const changed =
      ["outward", "rcmInward"].some((k) => JSON.stringify(snap[k as "outward"]) !== JSON.stringify(working[k as "outward"])) || JSON.stringify(snap.itc?.net) !== JSON.stringify(working.itc.net);
    return {
      working,
      over,
      banks,
      settled: {
        id: settled.id,
        paidOn: ymd(settled.paidOn),
        challan: settled.challan,
        arn: settled.arn,
        bank: settled.bankAccount?.name ?? null,
        createdAt: settled.createdAt.toISOString(),
        changed,
        snapshot: snap,
      },
      opening: openOf(settled),
      openingFrom: "settled" as const,
      suggestion: null,
      inputAtStart: null,
      setOff: settledOff(settled),
      blocked: null,
    };
  }
  const o = await openingFor(ctx, period);
  const inputAtStart = await inputBalance(ctx, shiftDay(working.from, -1));
  let open: Heads;
  let from: "previous" | "entered" | "suggested";
  let suggestion: Heads | null = null;
  if (o.prev) {
    open = closeOf(o.prev);
    from = "previous";
  } else {
    // First month settled here: the portal's electronic credit ledger at the start of the month.
    suggestion = splitHeads(Math.max(0, inputAtStart), false);
    open = opening ?? suggestion;
    from = opening ? "entered" : "suggested";
  }
  return {
    working,
    over,
    banks,
    settled: null,
    opening: open,
    openingFrom: from,
    suggestion,
    inputAtStart,
    setOff: setOff({ liab: working.liab, rcm: working.rcm, credit: addHeads(open, working.itc.net) }),
    blocked: o.blocked,
  };
}

const shiftDay = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

function split(account: AccountRef, amount: number): Line[] {
  const out: Line[] = [];
  let left = amount;
  while (left !== 0) {
    const part = Math.sign(left) * Math.min(Math.abs(left), LINE_MAX);
    out.push({ account, amount: part });
    left -= part;
  }
  return out;
}

export type SettleInput = { period: string; opening?: Partial<Heads> | null; bankAccountId?: string | null; challan?: string | null; paidOn: string; arn?: string | null };

/** Settle a month: output tax and reverse charge paid from input credit (legal order) and from a bank; the entry and the record. */
export async function settleGst(ctx: Ctx, input: SettleInput) {
  if (!isPeriod(input.period)) throw new MoneyError("Pick a month");
  await lockGst(ctx);
  const { from, to } = periodRange(input.period);
  const today = todayIst();
  if (to >= today) throw new MoneyError(`${periodLabel(input.period)} is not over yet`);
  if (!isDay(input.paidOn)) throw new MoneyError("Enter the day it was paid");
  if (input.paidOn > today) throw new MoneyError("The payment day is in the future");
  if (input.paidOn < from) throw new MoneyError("The payment day is before the month");
  if (await ctx.tx.gstSettlement.findFirst({ where: { period: input.period, cancelledAt: null } })) throw new MoneyError(`${periodLabel(input.period)} is already settled`, 409);

  let opening: Heads | null = null;
  if (input.opening) {
    opening = heads(input.opening);
    for (const v of Object.values(opening)) if (!Number.isInteger(v) || v < 0 || v > 100_000_000_000) throw new MoneyError("The credit brought forward must be ₹0 or more");
  }
  const m = await gstMonth(ctx, input.period, opening);
  if (m.blocked) throw new MoneyError(m.blocked, 409);
  if (m.openingFrom === "previous" && opening) throw new MoneyError("The credit brought forward comes from last month's settlement");
  const s = m.setOff;
  const cash = headsTotal(s.cash);
  const used = usedTotal(s.use);
  const liab = headsTotal(s.liab) + headsTotal(s.rcm);
  const reversal = headsTotal(s.reversal);
  const challan = text(input.challan, 30) || null;
  let bank: Pick<BankAccount, "id" | "name"> | null = null;
  if (cash > 0) {
    if (!challan) throw new MoneyError("Enter the challan number (CIN or CPIN)");
    const b = input.bankAccountId ? await ctx.tx.bankAccount.findUnique({ where: { id: input.bankAccountId } }) : await ctx.tx.bankAccount.findFirst({ where: { isDefault: true } });
    if (!b) throw new MoneyError("Pick the bank it was paid from");
    if (!b.active) throw new MoneyError(`${b.name} is closed`);
    bank = b;
  }

  const lines: Line[] = [...split({ type: "GST_OUTPUT" }, liab), ...split({ type: "GST_INPUT" }, reversal - used), ...(bank ? split({ type: "BANK", bankAccountId: bank.id }, -cash) : [])].filter(
    (l) => l.amount !== 0,
  );
  const entry = lines.length
    ? await post(ctx, { kind: "GST_PAYMENT", memo: `GST for ${periodLabel(input.period)}${challan ? `, challan ${challan}` : ""}`, occurredAt: atDay(input.paidOn), lines })
    : null;
  const rec = await ctx.tx.gstSettlement.create({
    data: {
      tenantId: ctx.tenantId,
      period: input.period,
      liabIgst: s.liab.igst,
      liabCgst: s.liab.cgst,
      liabSgst: s.liab.sgst,
      rcmIgst: s.rcm.igst,
      rcmCgst: s.rcm.cgst,
      rcmSgst: s.rcm.sgst,
      openIgst: m.opening.igst,
      openCgst: m.opening.cgst,
      openSgst: m.opening.sgst,
      itcIgst: m.working.itc.net.igst,
      itcCgst: m.working.itc.net.cgst,
      itcSgst: m.working.itc.net.sgst,
      useIgstIgst: s.use.igstIgst,
      useIgstCgst: s.use.igstCgst,
      useIgstSgst: s.use.igstSgst,
      useCgstCgst: s.use.cgstCgst,
      useCgstIgst: s.use.cgstIgst,
      useSgstSgst: s.use.sgstSgst,
      useSgstIgst: s.use.sgstIgst,
      cashIgst: s.cash.igst,
      cashCgst: s.cash.cgst,
      cashSgst: s.cash.sgst,
      closeIgst: s.close.igst,
      closeCgst: s.close.cgst,
      closeSgst: s.close.sgst,
      bankAccountId: bank?.id ?? null,
      challan,
      paidOn: new Date(`${input.paidOn}T00:00:00Z`),
      arn: text(input.arn, 30) || null,
      working: JSON.parse(JSON.stringify(m.working)),
      entryId: entry?.id ?? null,
      createdById: ctx.actorId,
    },
  });
  return { id: rec.id, period: rec.period, cash, used, bank: bank?.name ?? null, entryId: entry?.id ?? null };
}

/** Cancel the latest month's settlement (its entry is reversed today). */
export async function cancelGstSettlement(ctx: Ctx, id: string, reason: string) {
  await lockGst(ctx);
  const s = await ctx.tx.gstSettlement.findUnique({ where: { id } });
  if (!s || s.cancelledAt) throw new MoneyError("Settlement not found", 404);
  const why = text(reason, 200);
  if (!why) throw new MoneyError("Say why it is cancelled");
  const later = await ctx.tx.gstSettlement.findFirst({ where: { cancelledAt: null, period: { gt: s.period } }, orderBy: { period: "asc" } });
  if (later) throw new MoneyError(`Cancel ${periodLabel(later.period)} first: its credit brought forward comes from this one`, 409);
  if (s.entryId) await reverseEntry(ctx, s.entryId, `GST for ${periodLabel(s.period)} cancelled: ${why}`);
  await ctx.tx.gstSettlement.update({ where: { id }, data: { cancelledAt: new Date(), cancelReason: why } });
  return { id, period: s.period };
}

/** Settled months, newest first. */
export async function gstSettlements(ctx: Ctx, limit = 24) {
  const rows = await ctx.tx.gstSettlement.findMany({ where: { cancelledAt: null }, orderBy: { period: "desc" }, take: limit, include: { bankAccount: { select: { name: true } } } });
  return rows.map((s) => ({
    id: s.id,
    period: s.period,
    label: periodLabel(s.period),
    paidOn: ymd(s.paidOn),
    challan: s.challan,
    bank: s.bankAccount?.name ?? null,
    liab: s.liabIgst + s.liabCgst + s.liabSgst + s.rcmIgst + s.rcmCgst + s.rcmSgst,
    cash: s.cashIgst + s.cashCgst + s.cashSgst,
    used: s.useIgstIgst + s.useIgstCgst + s.useIgstSgst + s.useCgstCgst + s.useCgstIgst + s.useSgstSgst + s.useSgstIgst,
    carried: s.closeIgst + s.closeCgst + s.closeSgst,
  }));
}

// ───────────────────────────── A8.1 input credit register ─────────────────────────────

export type ItcDoc = Omit<Inward, "lines" | "sign"> & { taxable: number; igst: number; cgst: number; sgst: number; ineligible: number; rates: string };

const REGISTER_CAP = 5000;

/** Input credit by document, month, rate and supplier (notes take credit back; ineligible tax shown apart). */
export async function itcRegister(ctx: Ctx, from: string, to: string) {
  if (!isDay(from) || !isDay(to) || from > to) throw new MoneyError("Pick a valid period");
  if (Date.parse(to) - Date.parse(from) > 400 * 86_400_000) throw new MoneyError("At most 400 days at a time");
  const tenant = await ctx.tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { stateCode: true } });
  const ins = await inward(ctx, from, to, tenant.stateCode);
  const docs: ItcDoc[] = [];
  const months = new Map<string, Amt & { ineligible: number; docs: number }>();
  const rates = new Map<string, Amt & { rate: number | null }>();
  const parties = new Map<string, Amt & { party: string; gstin: string | null; docs: number }>();
  let totals = { ...noAmt(), ineligible: 0 };
  for (const d of ins) {
    let a = noAmt();
    let inel = 0;
    const rs = new Set<string>();
    const byRate: { rate: number | null; x: Amt }[] = [];
    for (const l of d.lines) {
      const x = lineAmt(l, d.sign);
      if (l.rate !== null) rs.add(`${l.rate}%`);
      const claimed = l.itc ? x : { taxable: x.taxable, igst: 0, cgst: 0, sgst: 0 };
      if (!l.itc) inel += headsTotal(x);
      a = addAmt(a, claimed);
      byRate.push({ rate: l.rate, x: claimed });
    }
    // A bill with no tax on it at all is not in the register (it is in 3B table 5).
    if (!headsTotal(a) && !inel) continue;
    for (const { rate, x } of byRate) {
      const rk = rate === null ? "-" : String(rate);
      rates.set(rk, { ...addAmt(rates.get(rk) ?? { rate, ...noAmt() }, x), rate });
    }
    const { lines: _l, sign: _s, ...rest } = d;
    void _l;
    void _s;
    if (docs.length < REGISTER_CAP) docs.push({ ...rest, ...a, ineligible: inel, rates: [...rs].join(", ") });
    const m = months.get(periodOf(d.date)) ?? { ...noAmt(), ineligible: 0, docs: 0 };
    months.set(periodOf(d.date), { ...addAmt(m, a), ineligible: m.ineligible + inel, docs: m.docs + 1 });
    const pk = d.gstin || d.party;
    const p = parties.get(pk) ?? { party: d.party, gstin: d.gstin, docs: 0, ...noAmt() };
    parties.set(pk, { ...addAmt(p, a), party: p.party, gstin: p.gstin, docs: p.docs + 1 });
    totals = { ...addAmt(totals, a), ineligible: totals.ineligible + inel };
  }
  return {
    from,
    to,
    docs,
    capped: docs.length >= REGISTER_CAP,
    byMonth: [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, v]) => ({ period, label: periodLabel(period), ...v })),
    byRate: [...rates.values()].filter((r) => r.taxable || headsTotal(r)).sort((a, b) => (a.rate ?? 999) - (b.rate ?? 999)),
    bySupplier: [...parties.values()].sort((a, b) => headsTotal(b) - headsTotal(a)),
    totals,
  };
}

// ───────────────────────────── A8.4 GSTR-2B match ─────────────────────────────

/** Store a month's GSTR-2B (a new upload replaces the old one). */
export async function import2b(ctx: Ctx, period: string, parsed: Parsed2b, fileName: string) {
  if (!isPeriod(period)) throw new MoneyError("Pick the month of the GSTR-2B");
  if (parsed.period && parsed.period !== period) throw new MoneyError(`This file is the GSTR-2B for ${periodLabel(parsed.period)}, not ${periodLabel(period)}`);
  if (!parsed.rows.length) throw new MoneyError("The file has no supplier bills or notes");
  if (parsed.rows.length > 20000) throw new MoneyError("The file has more than 20,000 documents");
  const tenant = await ctx.tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { gstin: true } });
  if (parsed.gstin && tenant.gstin && parsed.gstin !== tenant.gstin.toUpperCase()) throw new MoneyError(`This file is for GSTIN ${parsed.gstin}, not this business's ${tenant.gstin}`);
  await lockGst(ctx);
  await ctx.tx.gstr2bImport.deleteMany({ where: { period } });
  const imp = await ctx.tx.gstr2bImport.create({ data: { tenantId: ctx.tenantId, period, fileName: text(fileName, 120) || "GSTR-2B", gstin: parsed.gstin, createdById: ctx.actorId } });
  for (let i = 0; i < parsed.rows.length; i += 1000)
    await ctx.tx.gstr2bRow.createMany({
      data: parsed.rows.slice(i, i + 1000).map((r) => ({
        tenantId: ctx.tenantId,
        importId: imp.id,
        kind: r.kind,
        gstin: r.gstin,
        name: r.name,
        number: r.number,
        numberKey: r.numberKey,
        date: r.date ? new Date(`${r.date}T00:00:00Z`) : null,
        taxable: r.taxable,
        igst: r.igst,
        cgst: r.cgst,
        sgst: r.sgst,
        cess: r.cess,
        total: r.total,
        reverseCharge: r.reverseCharge,
        itcAvailable: r.itcAvailable,
      })),
    });
  return { id: imp.id, period, rows: parsed.rows.length, skipped: parsed.skipped };
}

export async function remove2b(ctx: Ctx, period: string) {
  if (!isPeriod(period)) throw new MoneyError("Pick a month");
  const r = await ctx.tx.gstr2bImport.deleteMany({ where: { period } });
  if (!r.count) throw new MoneyError("No GSTR-2B for that month", 404);
  return { period };
}

type OurDoc = { id: string; kind: "INV" | "CN"; date: string; number: string; ref: string; party: string; gstin: string; taxable: number; tax: number; itc: number; rcm: boolean; href: string };
type TheirDoc = {
  id: string;
  period: string;
  kind: string;
  gstin: string;
  name: string | null;
  number: string;
  numberKey: string;
  date: string | null;
  taxable: number;
  tax: number;
  itcAvailable: boolean;
  reverseCharge: boolean;
};
export type MatchRow = { ours: OurDoc | null; theirs: TheirDoc | null; diff: { taxable: number; tax: number } | null };

/**
 * Match a month's GSTR-2B with the purchase bills and credit notes: same
 * GSTIN, same number (ignoring spaces, signs and leading zeros), the
 * nearest date. Our bills from the earliest uploaded month on that no
 * uploaded 2B shows are listed as missing (the credit is at risk).
 */
export async function match2b(ctx: Ctx, period: string) {
  if (!isPeriod(period)) throw new MoneyError("Pick a month");
  const { to } = periodRange(period);
  const imports = await ctx.tx.gstr2bImport.findMany({ where: { period: { lte: period, gte: shiftPeriod(period, -12) } }, orderBy: { period: "asc" } });
  const current = imports.find((i) => i.period === period) ?? null;
  const windowFrom = imports.length ? periodRange(imports[0].period).from : periodRange(period).from;
  const rows = imports.length ? await ctx.tx.gstr2bRow.findMany({ where: { importId: { in: imports.map((i) => i.id) } } }) : [];
  const periodOfImport = new Map(imports.map((i) => [i.id, i.period]));
  const bills = await ctx.tx.purchaseBill.findMany({
    where: { type: { in: ["BILL", "CREDIT_NOTE"] }, cancelledAt: null, date: { gte: new Date(`${windowFrom}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } },
    include: { supplier: { select: { name: true, gstin: true } } },
    orderBy: { date: "asc" },
  });
  const ours: OurDoc[] = bills
    .filter((b) => b.cgst + b.sgst + b.igst > 0)
    .map((b) => ({
      id: b.id,
      kind: b.type === "BILL" ? "INV" : "CN",
      date: ymd(b.date),
      number: b.number,
      ref: b.supplierRef,
      party: b.supplier.name,
      gstin: (b.supplier.gstin ?? "").toUpperCase(),
      taxable: b.taxable,
      tax: b.cgst + b.sgst + b.igst,
      itc: b.itcTax,
      rcm: b.reverseCharge,
      href: `/admin/books/purchases/${b.id}`,
    }));
  const index = new Map<string, OurDoc[]>();
  for (const o of ours) {
    if (!o.gstin) continue;
    const k = `${o.gstin}|${o.kind}|${numberKey(o.ref)}`;
    index.set(k, [...(index.get(k) ?? []), o]);
  }
  const matchedBy = new Map<string, string>(); // our id → 2B row id
  const pairs = new Map<string, OurDoc>(); // 2B row id → ours
  // Older uploads claim their documents first.
  for (const r of [...rows].sort((a, b) => (periodOfImport.get(a.importId) ?? "").localeCompare(periodOfImport.get(b.importId) ?? ""))) {
    const k = `${r.gstin}|${r.kind === "CN" ? "CN" : "INV"}|${r.numberKey}`;
    const cands = (index.get(k) ?? []).filter((o) => !matchedBy.has(o.id));
    if (!cands.length) continue;
    const at = r.date ? Date.parse(ymd(r.date)) : null;
    const best = at === null ? cands[0] : cands.reduce((x, y) => (Math.abs(Date.parse(y.date) - at) < Math.abs(Date.parse(x.date) - at) ? y : x));
    matchedBy.set(best.id, r.id);
    pairs.set(r.id, best);
  }

  const theirs = (r: (typeof rows)[number]): TheirDoc => ({
    id: r.id,
    period: periodOfImport.get(r.importId) ?? period,
    kind: r.kind,
    gstin: r.gstin,
    name: r.name,
    number: r.number,
    numberKey: r.numberKey,
    date: r.date ? ymd(r.date) : null,
    taxable: r.taxable,
    tax: r.igst + r.cgst + r.sgst,
    itcAvailable: r.itcAvailable,
    reverseCharge: r.reverseCharge,
  });
  const mine = current ? rows.filter((r) => r.importId === current.id) : [];
  const matched: MatchRow[] = [];
  const different: MatchRow[] = [];
  const notInBooks: MatchRow[] = [];
  for (const r of mine) {
    const o = pairs.get(r.id) ?? null;
    const t = theirs(r);
    if (!o) {
      notInBooks.push({ ours: null, theirs: t, diff: null });
      continue;
    }
    const diff = { taxable: t.taxable - o.taxable, tax: t.tax - o.tax };
    const row = { ours: o, theirs: t, diff };
    if (Math.abs(diff.taxable) > MATCH_SLACK || Math.abs(diff.tax) > MATCH_SLACK) different.push(row);
    else matched.push(row);
  }
  const missing = ours.filter((o) => !matchedBy.has(o.id)).map((o) => ({ ours: o, theirs: null, diff: null, noGstin: !o.gstin, earlier: o.date < periodRange(period).from }));
  const noCredit = matched.concat(different).filter((m) => m.theirs && !m.theirs.itcAvailable);
  const sum = (xs: MatchRow[], f: (m: MatchRow) => number) => xs.reduce((a, m) => a + f(m), 0);
  return {
    period,
    label: periodLabel(period),
    upload: current ? { fileName: current.fileName, at: current.createdAt.toISOString(), rows: mine.length } : null,
    uploads: imports.map((i) => ({ period: i.period, label: periodLabel(i.period) })),
    windowFrom,
    matched,
    different,
    notInBooks,
    missing,
    noCredit,
    totals: {
      matchedItc: sum(matched, (m) => m.ours?.itc ?? 0),
      differentItc: sum(different, (m) => m.ours?.itc ?? 0),
      atRisk: missing.reduce((a, m) => a + m.ours.itc, 0),
      notInBooksTax: sum(notInBooks, (m) => m.theirs?.tax ?? 0),
    },
  };
}

export const describeSettled = (s: { paidOn: string; challan: string | null; bank: string | null }) =>
  `Paid ${showDay(s.paidOn)}${s.bank ? ` from ${s.bank}` : ""}${s.challan ? `, challan ${s.challan}` : ""}`;
