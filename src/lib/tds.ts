import type { BankAccount } from "@/generated/prisma/client";
import { MoneyError, post, recordPayment, reverseEntry, type Ctx, type Line } from "@/lib/ledger";
import { dayEnd, dayStart, isDay, todayIst } from "@/lib/books";
import { docNumber, fyCode } from "@/lib/gst";
import { nextSequence } from "@/lib/orders";
import { allocateSupplier, deallocateCredit, lockSupplier } from "@/lib/purchases";
import {
  challanDue,
  cleanSection,
  fyFrom,
  fyLabel,
  fyOf,
  fyTo,
  interestMonths,
  isPan,
  lateInterest,
  propose,
  quarterLabel,
  quarterOf,
  quarterRange,
  returnDue,
  STARTER_TDS_SECTIONS,
  type TdsSectionRow,
} from "@/lib/tds-math";

/**
 * TDS (A9): what we keep back from suppliers and pay to the government, and
 * what shops and customers keep back from us.
 *
 *   Kept back on a bill:   Dr Supplier                  Cr TDS payable
 *   Kept back at payment:  (lib/supplier-payments.ts and payment vouchers)
 *   Challan:               Dr TDS payable (+ interest)  Cr Bank
 *   A shop's TDS:          Dr TDS deducted by customers Cr Shop (its bills are settled)
 *
 * The register is read from the documents themselves (payments, vouchers,
 * TDS on bills), so it can't drift from the ledger; the books check proves it.
 */

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");
const atDay = (day: string) => (day === todayIst() ? new Date() : new Date(`${day}T12:00:00+05:30`));
const dbDay = (day: string) => new Date(`${day}T00:00:00Z`);
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const istDay = (d: Date) => new Date(d.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const lockTds = (ctx: Ctx) => ctx.tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${ctx.tenantId}:tds`}))`;
const LINE_MAX = 2_000_000_000;
function split(account: Line["account"], amount: number): Line[] {
  const out: Line[] = [];
  let left = amount;
  while (left !== 0) {
    const part = Math.sign(left) * Math.min(Math.abs(left), LINE_MAX);
    out.push({ account, amount: part });
    left -= part;
  }
  return out;
}

// ───────────────────────────── A9.1 sections ─────────────────────────────

/** The starter sections on first use. Idempotent. */
export async function ensureTdsSections(ctx: Ctx) {
  if (await ctx.tx.tdsSection.count()) return;
  await lockTds(ctx);
  if (await ctx.tx.tdsSection.count()) return;
  await ctx.tx.tdsSection.createMany({ data: STARTER_TDS_SECTIONS.map((s) => ({ tenantId: ctx.tenantId, ...s, note: s.note ?? null })), skipDuplicates: true });
}

export async function tdsSections(ctx: Ctx, all = false) {
  await ensureTdsSections(ctx);
  return ctx.tx.tdsSection.findMany({ where: all ? {} : { active: true }, orderBy: { code: "asc" } });
}

export type SectionInput = Partial<TdsSectionRow> & { id?: string | null };

/** Add or change a section. Rates are hundredths of a per cent; limits are paise (blank = none). */
export async function saveTdsSection(ctx: Ctx, input: SectionInput) {
  await ensureTdsSections(ctx);
  const code = cleanSection(input.code);
  if (!code) throw new MoneyError("The section looks wrong (like 194C or 194J(B))");
  const name = text(input.name, 80);
  if (name.length < 3) throw new MoneyError("Say what the section is for");
  const rate = (v: unknown, what: string) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 5000) throw new MoneyError(`${what} must be 0% to 50%`);
    return n;
  };
  const limit = (v: unknown, what: string) => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 100_000_000_000) throw new MoneyError(`${what} must be in rupees`);
    return n;
  };
  const data = {
    code,
    name,
    rateInd: rate(input.rateInd, "The rate for individuals"),
    rateOther: rate(input.rateOther, "The rate for others"),
    rateNoPan: rate(input.rateNoPan, "The rate without PAN"),
    single: limit(input.single, "The limit at a time"),
    yearly: limit(input.yearly, "The limit in a year"),
    overOnly: !!input.overOnly,
    active: input.active !== false,
    note: text(input.note, 300) || null,
  };
  try {
    if (input.id) {
      const old = await ctx.tx.tdsSection.findUnique({ where: { id: input.id } });
      if (!old) throw new MoneyError("Section not found", 404);
      return await ctx.tx.tdsSection.update({ where: { id: old.id }, data });
    }
    return await ctx.tx.tdsSection.create({ data: { tenantId: ctx.tenantId, ...data } });
  } catch (e) {
    if ((e as { code?: string })?.code === "P2002") throw new MoneyError(`${code} is already there`, 409);
    throw e;
  }
}

async function sectionOf(ctx: Ctx, code: string) {
  await ensureTdsSections(ctx);
  return ctx.tx.tdsSection.findUnique({ where: { tenantId_code: { tenantId: ctx.tenantId, code } } });
}

// ───────────────────────────── A9.2 what to deduct ─────────────────────────────

export type ProposeInput = {
  section: string;
  /** A supplier, or a voucher's party by PAN / name. */
  supplierId?: string | null;
  pan?: string | null;
  party?: string | null;
  /** The amount TDS is worked on (paise). */
  base: number;
  date: string;
  /** "BILL": the year is the party's bills; "PAYMENT": their payments. */
  basis: "BILL" | "PAYMENT";
  /** Leave out this document (it is the one being worked on). */
  excludeId?: string | null;
};

/** The year so far with a party: amounts billed or paid before this one, and the TDS already kept back under the section. */
async function yearSoFar(ctx: Ctx, section: string, p: ProposeInput) {
  const from = fyFrom(fyOf(p.date));
  const range = { gte: dbDay(from), lte: dbDay(p.date) };
  const ex = p.excludeId ?? "";
  let before = 0;
  let deducted = 0;
  if (p.supplierId) {
    if (p.basis === "BILL") {
      const bills = await ctx.tx.purchaseBill.findMany({ where: { supplierId: p.supplierId, type: "BILL", cancelledAt: null, date: range, id: { not: ex } }, select: { taxable: true } });
      before = bills.reduce((s, b) => s + b.taxable, 0);
    } else {
      const pays = await ctx.tx.supplierPayment.findMany({ where: { supplierId: p.supplierId, cancelledAt: null, date: range, id: { not: ex } }, select: { amount: true, tds: true } });
      before = pays.reduce((s, x) => s + x.amount + x.tds, 0);
    }
    const [pays, credits] = await Promise.all([
      ctx.tx.supplierPayment.findMany({ where: { supplierId: p.supplierId, cancelledAt: null, tdsSection: section, date: { gte: dbDay(from), lte: dbDay(fyTo(fyOf(p.date))) }, id: { not: ex } }, select: { tds: true } }),
      ctx.tx.supplierCredit.findMany({ where: { supplierId: p.supplierId, kind: "TDS", tdsSection: section, date: { gte: dayStart(from), lte: dayEnd(fyTo(fyOf(p.date))) }, id: { not: ex } }, select: { amount: true } }),
    ]);
    deducted = pays.reduce((s, x) => s + x.tds, 0) + credits.reduce((s, x) => s + x.amount, 0);
  } else {
    const pan = isPan(p.pan) ? p.pan : null;
    const name = text(p.party, 80).toLowerCase();
    if (!pan && !name) return { before: 0, deducted: 0 };
    const vs = await ctx.tx.voucher.findMany({
      where: { type: "PAYMENT", cancelledAt: null, date: { gte: dbDay(from), lte: dbDay(fyTo(fyOf(p.date))) }, id: { not: ex }, ...(pan ? { partyPan: pan } : { party: { equals: name, mode: "insensitive" } }) },
      select: { date: true, amount: true, tds: true, gst: true, tdsSection: true },
    });
    for (const v of vs) {
      if (ymd(v.date) <= p.date) before += v.amount + v.tds - v.gst;
      if (v.tdsSection === section) deducted += v.tds;
    }
  }
  return { before, deducted };
}

/** What the TDS should be, and why (the accountant may change it, with a reason). */
export async function proposeTds(ctx: Ctx, p: ProposeInput) {
  const code = cleanSection(p.section);
  if (!code) throw new MoneyError("Pick the TDS section");
  if (!isDay(p.date)) throw new MoneyError("Pick the date");
  if (!Number.isInteger(p.base) || p.base < 0) throw new MoneyError("The amount must be in rupees and paise");
  const s = await sectionOf(ctx, code);
  if (!s) return { section: code, known: false, rate: 0, tds: 0, taxable: 0, why: `${code} is not in the TDS sections; add it under Books, TDS, Sections`, pan: null, before: 0, deducted: 0 };
  const supplier = p.supplierId ? await ctx.tx.supplier.findUnique({ where: { id: p.supplierId }, select: { pan: true, gstin: true } }) : null;
  const pan = (supplier ? supplier.pan || (supplier.gstin ? supplier.gstin.slice(2, 12) : null) : p.pan) ?? null;
  const y = await yearSoFar(ctx, code, p);
  return { section: code, known: true, ...propose(s, pan, p.base, y.before, y.deducted), pan: isPan(pan) ? pan : null, ...y };
}

// ───────────────────────────── TDS on a bill ─────────────────────────────

export type BillTdsInput = { purchaseBillId: string; section: string; base: number; tds: number; date?: string | null; note?: string | null };

/** Keep back TDS on a supplier's bill (at the time it is booked): the bill's unpaid amount falls by the TDS. */
export async function deductOnBill(ctx: Ctx, input: BillTdsInput) {
  const pb = await ctx.tx.purchaseBill.findUnique({ where: { id: String(input.purchaseBillId) }, include: { supplier: true } });
  if (!pb || pb.type !== "BILL") throw new MoneyError("Bill not found", 404);
  if (pb.cancelledAt) throw new MoneyError("This bill is cancelled", 409);
  await lockSupplier(ctx, pb.supplierId);
  const sb = await ctx.tx.supplierBill.findUnique({ where: { purchaseBillId: pb.id } });
  if (!sb) throw new MoneyError("This bill has no account with the supplier", 409);
  if (await ctx.tx.supplierCredit.findFirst({ where: { kind: "TDS", againstBillId: sb.id } })) throw new MoneyError("TDS is already kept back on this bill", 409);
  const section = cleanSection(input.section);
  if (!section) throw new MoneyError("Pick the TDS section");
  if (!(await sectionOf(ctx, section))) throw new MoneyError(`${section} is not in the TDS sections`);
  const base = Number(input.base);
  const tds = Number(input.tds);
  if (!Number.isInteger(base) || base <= 0 || base > pb.total) throw new MoneyError("The amount TDS is on must be more than ₹0 and not more than the bill");
  if (!Number.isInteger(tds) || tds <= 0) throw new MoneyError("The TDS must be more than ₹0");
  if (tds > base) throw new MoneyError("The TDS is more than the amount it is on");
  const open = sb.amount - sb.paid;
  if (tds > open) throw new MoneyError(open ? `Only ${(open / 100).toFixed(2)} of this bill is unpaid` : "This bill is paid already: keep the TDS back from the next payment instead", 409);
  const billDay = ymd(pb.date);
  const date = input.date && isDay(input.date) ? input.date : billDay;
  if (date < billDay) throw new MoneyError("The TDS date is before the bill");
  if (date > todayIst()) throw new MoneyError("The TDS date is in the future");
  const fy = fyCode(dayStart(date));
  const number = docNumber("TDS", fy, await nextSequence(ctx.tx, ctx.tenantId, `tds:${fy}`));
  const note = text(input.note, 200) || null;
  const entry = await post(ctx, {
    kind: "TDS_DEDUCTION",
    memo: `TDS ${section} kept back on ${pb.supplierRef} from ${pb.supplier.name}${note ? ` · ${note}` : ""}`,
    supplierId: pb.supplierId,
    occurredAt: atDay(date),
    lines: [
      { account: { type: "PAYABLE", supplierId: pb.supplierId }, amount: tds },
      { account: { type: "TDS_PAYABLE" }, amount: -tds },
    ],
  });
  const credit = await ctx.tx.supplierCredit.create({
    data: { tenantId: ctx.tenantId, supplierId: pb.supplierId, kind: "TDS", number, date: dayStart(date), amount: tds, againstBillId: sb.id, entryId: entry.id, note, tdsSection: section, tdsBase: base, createdById: ctx.actorId },
  });
  await allocateSupplier(ctx, pb.supplierId);
  return { id: credit.id, number, tds, section };
}

/** Undo TDS kept back on a bill (entered by mistake): reversed today, and the bill is owed in full again. */
export async function cancelBillTds(ctx: Ctx, creditId: string, reason: string) {
  const c = await ctx.tx.supplierCredit.findUnique({ where: { id: creditId } });
  if (!c || c.kind !== "TDS") throw new MoneyError("Not found", 404);
  const why = text(reason, 200);
  if (why.length < 3) throw new MoneyError("Say why it is cancelled");
  await lockSupplier(ctx, c.supplierId);
  await deallocateCredit(ctx, c.id);
  if (c.entryId) await reverseEntry(ctx, c.entryId, `TDS ${c.number} cancelled: ${why}`);
  await ctx.tx.supplierCredit.delete({ where: { id: c.id } });
  await allocateSupplier(ctx, c.supplierId);
  return { id: c.id, number: c.number };
}

/** TDS kept back on a bill, if any (for the bill's page). */
export async function billTds(ctx: Ctx, purchaseBillId: string) {
  const sb = await ctx.tx.supplierBill.findUnique({ where: { purchaseBillId }, select: { id: true, amount: true, paid: true } });
  if (!sb) return { open: 0, tds: null };
  const c = await ctx.tx.supplierCredit.findFirst({ where: { kind: "TDS", againstBillId: sb.id } });
  return { open: sb.amount - sb.paid, tds: c ? { id: c.id, number: c.number, date: istDay(c.date), section: c.tdsSection!, base: c.tdsBase!, tds: c.amount, note: c.note } : null };
}

// ───────────────────────────── A9.5 register ─────────────────────────────

export type TdsSource = "BILL" | "PAYMENT" | "VOUCHER";
export const TDS_SOURCE_LABEL: Record<TdsSource, string> = { BILL: "On a bill", PAYMENT: "Supplier payment", VOUCHER: "Payment voucher" };
export type TdsRow = { id: string; date: string; source: TdsSource; number: string; href: string; party: string; pan: string | null; section: string; base: number; tds: number; rate: number };

/** Every TDS we kept back in a period, from the documents. */
export async function tdsDeducted(ctx: Ctx, from: string, to: string): Promise<TdsRow[]> {
  if (!isDay(from) || !isDay(to) || from > to) throw new MoneyError("Pick a valid period");
  const range = { gte: dbDay(from), lte: dbDay(to) };
  const [pays, vouchers, credits] = await Promise.all([
    ctx.tx.supplierPayment.findMany({ where: { cancelledAt: null, tds: { gt: 0 }, date: range }, include: { supplier: { select: { name: true, pan: true, gstin: true } } } }),
    ctx.tx.voucher.findMany({ where: { type: "PAYMENT", cancelledAt: null, tds: { gt: 0 }, date: range } }),
    ctx.tx.supplierCredit.findMany({ where: { kind: "TDS", date: { gte: dayStart(from), lte: dayEnd(to) } }, include: { supplier: { select: { name: true, pan: true, gstin: true } } } }),
  ]);
  const billIds = credits.map((c) => c.againstBillId).filter((x): x is string => !!x);
  const bills = billIds.length ? await ctx.tx.supplierBill.findMany({ where: { id: { in: billIds } }, select: { id: true, purchaseBillId: true } }) : [];
  const pbOf = new Map(bills.map((b) => [b.id, b.purchaseBillId]));
  const panOf = (s: { pan: string | null; gstin: string | null }) => (isPan(s.pan) ? s.pan : s.gstin && isPan(s.gstin.slice(2, 12)) ? s.gstin.slice(2, 12) : null);
  const rate = (tds: number, base: number) => (base > 0 ? Math.round((tds * 10_000) / base) : 0);
  const rows: TdsRow[] = [
    ...pays.map((p) => ({ id: p.id, date: ymd(p.date), source: "PAYMENT" as const, number: p.number, href: `/admin/books/payments/${p.id}`, party: p.supplier.name, pan: panOf(p.supplier), section: p.tdsSection ?? "?", base: p.amount + p.tds, tds: p.tds, rate: rate(p.tds, p.amount + p.tds) })),
    ...vouchers.map((v) => {
      const base = v.amount + v.tds - v.gst;
      return { id: v.id, date: ymd(v.date), source: "VOUCHER" as const, number: v.number, href: `/admin/books/vouchers/${v.id}`, party: v.party ?? "(no name)", pan: isPan(v.partyPan) ? v.partyPan : null, section: v.tdsSection ?? "?", base, tds: v.tds, rate: rate(v.tds, base) };
    }),
    ...credits.map((c) => {
      const pb = c.againstBillId ? pbOf.get(c.againstBillId) : null;
      return { id: c.id, date: istDay(c.date), source: "BILL" as const, number: c.number, href: pb ? `/admin/books/purchases/${pb}` : `/admin/books/suppliers/${c.supplierId}`, party: c.supplier.name, pan: panOf(c.supplier), section: c.tdsSection ?? "?", base: c.tdsBase ?? 0, tds: c.amount, rate: rate(c.amount, c.tdsBase ?? 0) };
    }),
  ];
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number));
}

/** The register for a period, with totals by section, party and quarter. */
export async function tdsRegister(ctx: Ctx, from: string, to: string) {
  if (!isDay(from) || !isDay(to) || from > to) throw new MoneyError("Pick a valid period");
  if (Date.parse(to) - Date.parse(from) > 400 * 86_400_000) throw new MoneyError("At most 400 days at a time");
  const rows = await tdsDeducted(ctx, from, to);
  const group = <K extends string>(key: (r: TdsRow) => K) => {
    const m = new Map<K, { base: number; tds: number; docs: number }>();
    for (const r of rows) {
      const g = m.get(key(r)) ?? { base: 0, tds: 0, docs: 0 };
      m.set(key(r), { base: g.base + r.base, tds: g.tds + r.tds, docs: g.docs + 1 });
    }
    return m;
  };
  const bySection = [...group((r) => r.section).entries()].map(([section, v]) => ({ section, ...v })).sort((a, b) => a.section.localeCompare(b.section));
  const parties = group((r) => `${r.pan ?? ""}|${r.party}`);
  const byParty = [...parties.entries()].map(([k, v]) => ({ pan: k.split("|")[0] || null, party: k.slice(k.indexOf("|") + 1), ...v })).sort((a, b) => b.tds - a.tds);
  const byQuarter = [...group((r) => `${fyOf(r.date)}|${quarterOf(r.date)}`).entries()].map(([k, v]) => {
    const [fy, q] = k.split("|").map(Number);
    return { fy, q, label: quarterLabel(fy, q), ...v };
  });
  return { from, to, rows, bySection, byParty, byQuarter, totals: { base: rows.reduce((s, r) => s + r.base, 0), tds: rows.reduce((s, r) => s + r.tds, 0), noPan: rows.filter((r) => !r.pan).length } };
}

// ───────────────────────────── A9.3 challans ─────────────────────────────

export type ChallanInput = {
  section: string;
  period: string;
  tax: number;
  interest?: number;
  lateFee?: number;
  bankAccountId?: string | null;
  paidOn: string;
  bsrCode: string;
  serial: string;
  note?: string | null;
};

const isPeriod = (p: unknown): p is string => typeof p === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(p);
const periodLabel = (p: string) => new Date(`${p}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

/** The head that interest and late fees on taxes go to (made on first use). */
async function interestHead(ctx: Ctx) {
  const h = await ctx.tx.ledgerHead.findFirst({ where: { key: "tax_interest" } });
  if (h) return h.id;
  const named = await ctx.tx.ledgerHead.findFirst({ where: { name: { equals: "Interest and late fees on taxes", mode: "insensitive" } } });
  if (named) return named.id;
  return (await ctx.tx.ledgerHead.create({ data: { tenantId: ctx.tenantId, key: "tax_interest", name: "Interest and late fees on taxes", group: "INDIRECT_EXPENSES" } })).id;
}

/** Record a TDS challan paid from a bank. */
export async function payTdsChallan(ctx: Ctx, input: ChallanInput) {
  await lockTds(ctx);
  const section = cleanSection(input.section);
  if (!section) throw new MoneyError("Pick the TDS section");
  if (!isPeriod(input.period)) throw new MoneyError("Pick the month the TDS was kept back in");
  const today = todayIst();
  if (!isDay(input.paidOn)) throw new MoneyError("Enter the day it was paid");
  if (input.paidOn > today) throw new MoneyError("The payment day is in the future");
  if (input.paidOn < `${input.period}-01`) throw new MoneyError("The payment day is before the month");
  const amt = (v: unknown, what: string) => {
    const n = Number(v ?? 0);
    if (!Number.isInteger(n) || n < 0 || n > 10_000_000_000) throw new MoneyError(`${what} must be ₹0 or more`);
    return n;
  };
  const tax = amt(input.tax, "The TDS");
  const interest = amt(input.interest, "Interest");
  const lateFee = amt(input.lateFee, "The late fee");
  const total = tax + interest + lateFee;
  if (total <= 0) throw new MoneyError("Enter the amount paid");
  const bsrCode = text(input.bsrCode, 10).replace(/\s/g, "");
  const serial = text(input.serial, 10).replace(/\s/g, "");
  if (!/^\d{7}$/.test(bsrCode)) throw new MoneyError("The BSR code is 7 digits (on the challan counterfoil)");
  if (!/^\d{5}$/.test(serial)) throw new MoneyError("The challan serial number is 5 digits");
  if (await ctx.tx.tdsChallan.findFirst({ where: { cancelledAt: null, bsrCode, serial, paidOn: dbDay(input.paidOn) } })) throw new MoneyError("This challan is already entered", 409);
  const b: BankAccount | null = input.bankAccountId ? await ctx.tx.bankAccount.findUnique({ where: { id: input.bankAccountId } }) : await ctx.tx.bankAccount.findFirst({ where: { isDefault: true } });
  if (!b) throw new MoneyError("Pick the bank it was paid from");
  if (!b.active) throw new MoneyError(`${b.name} is closed`);
  const extra = interest + lateFee;
  const lines: Line[] = [
    ...split({ type: "TDS_PAYABLE" }, tax),
    ...(extra ? split({ type: "HEAD", headId: await interestHead(ctx) }, extra) : []),
    ...split({ type: "BANK", bankAccountId: b.id }, -total),
  ];
  const fy = fyCode(dayStart(input.paidOn));
  const number = docNumber("TC", fy, await nextSequence(ctx.tx, ctx.tenantId, `tc:${fy}`));
  const entry = await post(ctx, { kind: "TDS_PAYMENT", memo: `TDS ${section} for ${periodLabel(input.period)}, challan ${bsrCode}/${serial}`, occurredAt: atDay(input.paidOn), lines });
  const c = await ctx.tx.tdsChallan.create({
    data: { tenantId: ctx.tenantId, number, section, period: input.period, tax, interest, lateFee, bankAccountId: b.id, paidOn: dbDay(input.paidOn), bsrCode, serial, note: text(input.note, 200) || null, entryId: entry.id, createdById: ctx.actorId },
  });
  return { id: c.id, number, total, bank: b.name };
}

export async function cancelTdsChallan(ctx: Ctx, id: string, reason: string) {
  await lockTds(ctx);
  const c = await ctx.tx.tdsChallan.findUnique({ where: { id } });
  if (!c || c.cancelledAt) throw new MoneyError("Challan not found", 404);
  const why = text(reason, 200);
  if (why.length < 3) throw new MoneyError("Say why it is cancelled");
  if (c.entryId) await reverseEntry(ctx, c.entryId, `TDS challan ${c.number} cancelled: ${why}`);
  await ctx.tx.tdsChallan.update({ where: { id }, data: { cancelledAt: new Date(), cancelReason: why } });
  return { id, number: c.number };
}

/** Months of a financial year: TDS kept back, paid by challan, due date, interest if late. */
export async function tdsYear(ctx: Ctx, fy: number) {
  const today = todayIst();
  const to = fyTo(fy) < today ? fyTo(fy) : today;
  const rows = fyFrom(fy) <= to ? await tdsDeducted(ctx, fyFrom(fy), to) : [];
  const periods = Array.from({ length: 12 }, (_, i) => {
    const m = 4 + i;
    return `${m > 12 ? fy + 1 : fy}-${String(((m - 1) % 12) + 1).padStart(2, "0")}`;
  });
  const challans = await ctx.tx.tdsChallan.findMany({ where: { period: { in: periods } }, orderBy: [{ paidOn: "asc" }, { createdAt: "asc" }], include: { bankAccount: { select: { name: true } } } });
  const live = challans.filter((c) => !c.cancelledAt);
  const keys = new Set([...rows.map((r) => `${r.date.slice(0, 7)}|${r.section}`), ...live.map((c) => `${c.period}|${c.section}`)]);
  const groups = [...keys]
    .map((k) => {
      const [period, section] = k.split("|");
      const ded = rows.filter((r) => r.date.slice(0, 7) === period && r.section === section);
      const paidBy = live.filter((c) => c.period === period && c.section === section);
      const due = challanDue(period);
      // Set the challans against the deductions, oldest first, for interest on late payment.
      let interest = 0;
      let lastPaid: string | null = null;
      const pool = paidBy.map((c) => ({ left: c.tax, paidOn: ymd(c.paidOn) }));
      for (const r of ded) {
        let need = r.tds;
        for (const c of pool) {
          if (need <= 0) break;
          if (c.left <= 0) continue;
          const use = Math.min(need, c.left);
          c.left -= use;
          need -= use;
          lastPaid = c.paidOn;
          if (c.paidOn > due) interest += lateInterest(use, interestMonths(r.date, c.paidOn));
        }
        if (need > 0 && today > due) interest += lateInterest(need, interestMonths(r.date, today));
      }
      const deducted = ded.reduce((s, r) => s + r.tds, 0);
      const paid = paidBy.reduce((s, c) => s + c.tax, 0);
      const interestPaid = paidBy.reduce((s, c) => s + c.interest, 0);
      const unpaid = Math.max(0, deducted - paid);
      const status: "PAID" | "PAID_LATE" | "DUE" | "LATE" | "OVER" = paid > deducted ? "OVER" : unpaid ? (today > due ? "LATE" : "DUE") : lastPaid && lastPaid > due ? "PAID_LATE" : "PAID";
      return { period, label: periodLabel(period), section, due, deducted, docs: ded.length, paid, unpaid, interest, interestPaid, interestDue: Math.max(0, interest - interestPaid), status };
    })
    .sort((a, b) => a.period.localeCompare(b.period) || a.section.localeCompare(b.section));
  const sum = (k: "deducted" | "paid" | "unpaid" | "interestDue") => groups.reduce((s, g) => s + g[k], 0);
  return {
    fy,
    label: fyLabel(fy),
    groups,
    challans: challans.map((c) => ({ id: c.id, number: c.number, section: c.section, period: c.period, periodLabel: periodLabel(c.period), tax: c.tax, interest: c.interest, lateFee: c.lateFee, paidOn: ymd(c.paidOn), bsrCode: c.bsrCode, serial: c.serial, bank: c.bankAccount?.name ?? null, note: c.note, cancelledAt: c.cancelledAt, cancelReason: c.cancelReason })),
    totals: { deducted: sum("deducted"), paid: sum("paid"), unpaid: sum("unpaid"), interestDue: sum("interestDue") },
  };
}

// ───────────────────────────── A9.5 quarterly return (26Q) ─────────────────────────────

export type Return26qRow = TdsRow & { challan: { number: string; bsrCode: string; serial: string; paidOn: string } | null; covered: number };

/** A quarter's 26Q working: each deduction with the challan that paid it, and what is missing. */
export async function return26q(ctx: Ctx, fy: number, q: number) {
  if (!Number.isInteger(fy) || fy < 2000 || fy > 2100 || ![1, 2, 3, 4].includes(q)) throw new MoneyError("Pick a quarter");
  const { from, to } = quarterRange(fy, q);
  const rows = await tdsDeducted(ctx, from, to);
  const periods = [...new Set([from.slice(0, 7), `${from.slice(0, 5)}${String(Number(from.slice(5, 7)) + 1).padStart(2, "0")}`, to.slice(0, 7)])];
  const challans = await ctx.tx.tdsChallan.findMany({ where: { cancelledAt: null, period: { in: periods } }, orderBy: [{ paidOn: "asc" }, { createdAt: "asc" }] });
  const pool = challans.map((c) => ({ c, left: c.tax }));
  const out: Return26qRow[] = rows.map((r) => {
    let need = r.tds;
    let first: (typeof pool)[number] | null = null;
    for (const p of pool) {
      if (need <= 0) break;
      if (p.c.period !== r.date.slice(0, 7) || p.c.section !== r.section || p.left <= 0) continue;
      const use = Math.min(need, p.left);
      p.left -= use;
      need -= use;
      first ??= p;
    }
    return { ...r, challan: first ? { number: first.c.number, bsrCode: first.c.bsrCode, serial: first.c.serial, paidOn: ymd(first.c.paidOn) } : null, covered: r.tds - need };
  });
  const warnings: string[] = [];
  const noPan = out.filter((r) => !r.pan);
  if (noPan.length) warnings.push(`${noPan.length} deduction${noPan.length === 1 ? " has" : "s have"} no PAN for the party: the return needs it (and without PAN the higher rate applies). Add the PAN to the supplier or the voucher.`);
  const unpaid = out.filter((r) => r.covered < r.tds);
  if (unpaid.length) warnings.push(`${unpaid.length} deduction${unpaid.length === 1 ? " is" : "s are"} not fully paid by a challan for its month and section.`);
  const spare = pool.filter((p) => p.left > 0);
  if (spare.length) warnings.push(`${spare.length} challan${spare.length === 1 ? " has" : "s have"} tax not matched to any deduction this quarter (${spare.map((p) => p.c.number).join(", ")}).`);
  const unknown = out.filter((r) => r.section === "?");
  if (unknown.length) warnings.push(`${unknown.length} deduction${unknown.length === 1 ? " has" : "s have"} no section.`);
  return {
    fy,
    q,
    label: quarterLabel(fy, q),
    from,
    to,
    due: returnDue(fy, q),
    rows: out,
    challans: challans.map((c) => ({ number: c.number, section: c.section, period: c.period, bsrCode: c.bsrCode, serial: c.serial, paidOn: ymd(c.paidOn), tax: c.tax, interest: c.interest, lateFee: c.lateFee, used: c.tax - (pool.find((p) => p.c.id === c.id)?.left ?? 0) })),
    totals: { base: out.reduce((s, r) => s + r.base, 0), tds: out.reduce((s, r) => s + r.tds, 0), paid: challans.reduce((s, c) => s + c.tax, 0) },
    warnings,
  };
}

// ───────────────────────────── A9.4 TDS kept back from us ─────────────────────────────

export type ShopTdsInput = { retailerId: string; amount: number; section?: string | null; date: string; certificate?: string | null; note?: string | null };

/** A shop kept back TDS from what it paid us: their bills are settled by it (Dr TDS deducted by customers, Cr the shop). */
export async function recordShopTds(ctx: Ctx, input: ShopTdsInput) {
  const r = await ctx.tx.retailerProfile.findUnique({ where: { id: String(input.retailerId) }, select: { id: true, outletName: true } });
  if (!r) throw new MoneyError("Shop not found", 404);
  const amount = Number(input.amount);
  if (!Number.isInteger(amount) || amount <= 0) throw new MoneyError("The TDS must be more than ₹0");
  const section = cleanSection(input.section || "194Q");
  if (!section) throw new MoneyError("The section looks wrong (like 194Q)");
  if (!isDay(input.date)) throw new MoneyError("Enter the date they kept it back");
  if (input.date > todayIst()) throw new MoneyError("The date is in the future");
  const certificate = text(input.certificate, 30) || null;
  const p = await recordPayment(ctx, {
    retailerId: r.id,
    amount,
    method: "TDS",
    purpose: "DUES",
    reference: certificate,
    note: text(input.note, 200) || `TDS ${section} kept back by ${r.outletName}`,
    occurredAt: atDay(input.date),
    collectorId: null,
    atOffice: true,
    tdsSection: section,
  });
  return { id: p.id, number: p.number, amount };
}

/** The TDS certificate (Form 16A) number for a shop's TDS, once it arrives. */
export async function setShopTdsCertificate(ctx: Ctx, paymentId: string, certificate: string) {
  const p = await ctx.tx.payment.findUnique({ where: { id: paymentId } });
  if (!p || p.method !== "TDS") throw new MoneyError("Not found", 404);
  return ctx.tx.payment.update({ where: { id: p.id }, data: { reference: text(certificate, 30) || null } });
}

export type ReceivedRow = { id: string; date: string; source: "SHOP" | "VOUCHER"; number: string; href: string; party: string; pan: string | null; section: string; tds: number; certificate: string | null };

/** TDS customers kept back from us in a period (claimed in our income tax return against Form 26AS). */
export async function tdsReceived(ctx: Ctx, from: string, to: string) {
  if (!isDay(from) || !isDay(to) || from > to) throw new MoneyError("Pick a valid period");
  const [shops, vouchers] = await Promise.all([
    ctx.tx.payment.findMany({ where: { method: "TDS", state: "CONFIRMED", collectedAt: { gte: dayStart(from), lte: dayEnd(to) } }, include: { retailer: { select: { id: true, outletName: true, legalName: true, gstin: true } } }, orderBy: { collectedAt: "asc" } }),
    ctx.tx.voucher.findMany({ where: { type: "RECEIPT", cancelledAt: null, tds: { gt: 0 }, date: { gte: dbDay(from), lte: dbDay(to) } }, orderBy: { date: "asc" } }),
  ]);
  const rows: ReceivedRow[] = [
    ...shops.map((p) => ({ id: p.id, date: istDay(p.collectedAt), source: "SHOP" as const, number: p.number, href: `/admin/khata/${p.retailer.id}`, party: p.retailer.legalName || p.retailer.outletName, pan: p.retailer.gstin && isPan(p.retailer.gstin.slice(2, 12)) ? p.retailer.gstin.slice(2, 12) : null, section: p.tdsSection ?? "194Q", tds: p.amount, certificate: p.reference })),
    ...vouchers.map((v) => ({ id: v.id, date: ymd(v.date), source: "VOUCHER" as const, number: v.number, href: `/admin/books/vouchers/${v.id}`, party: v.party ?? "(no name)", pan: isPan(v.partyPan) ? v.partyPan : null, section: v.tdsSection ?? "?", tds: v.tds, certificate: v.reference })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const byParty = new Map<string, { party: string; pan: string | null; tds: number; docs: number; pending: number }>();
  for (const r of rows) {
    const k = `${r.pan ?? ""}|${r.party}`;
    const g = byParty.get(k) ?? { party: r.party, pan: r.pan, tds: 0, docs: 0, pending: 0 };
    byParty.set(k, { ...g, tds: g.tds + r.tds, docs: g.docs + 1, pending: g.pending + (r.source === "SHOP" && !r.certificate ? 1 : 0) });
  }
  return { from, to, rows, byParty: [...byParty.values()].sort((a, b) => b.tds - a.tds), totals: { tds: rows.reduce((s, r) => s + r.tds, 0), pending: rows.filter((r) => r.source === "SHOP" && !r.certificate).length } };
}

/** The TDS home: this year's figures. */
export async function tdsOverview(ctx: Ctx, day = todayIst()) {
  await ensureTdsSections(ctx);
  const fy = fyOf(day);
  const y = await tdsYear(ctx, fy);
  const bal = await ctx.tx.ledgerLine.groupBy({ by: ["accountId"], where: { account: { type: { in: ["TDS_PAYABLE", "TDS_RECEIVABLE"] } } }, _sum: { amount: true } });
  const accs = bal.length ? await ctx.tx.ledgerAccount.findMany({ where: { id: { in: bal.map((b) => b.accountId) } }, select: { id: true, type: true } }) : [];
  const of = (t: string) => bal.filter((b) => accs.find((a) => a.id === b.accountId)?.type === t).reduce((s, b) => s + (b._sum.amount ?? 0), 0);
  const q = quarterOf(day);
  const lastQ = q === 1 ? { fy: fy - 1, q: 4 } : { fy, q: q - 1 };
  return { fy, label: fyLabel(fy), year: y, payable: -of("TDS_PAYABLE"), receivable: of("TDS_RECEIVABLE"), lastQuarter: { ...lastQ, label: quarterLabel(lastQ.fy, lastQ.q), due: returnDue(lastQ.fy, lastQ.q) } };
}

export async function tdsBanks(ctx: Ctx) {
  return ctx.tx.bankAccount.findMany({ where: { active: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, name: true, isDefault: true } });
}

export { fyOf, fyLabel, quarterOf, quarterLabel, isPeriod, periodLabel };
