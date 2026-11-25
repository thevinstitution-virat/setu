import type { IssuedChequeStatus, SupplierPayMethod } from "@/generated/prisma/client";
import { MoneyError, post, reverseEntry, type AccountRef, type Ctx, type Line } from "@/lib/ledger";
import { docNumber, fyCode } from "@/lib/gst";
import { nextSequence } from "@/lib/orders";
import { dayEnd, dayStart, isDay, todayIst } from "@/lib/books";
import { allocateSupplier, deallocateCredit, lockSupplier } from "@/lib/purchases";
import { CHEQUE_STATUS_LABEL, PAY_METHOD_LABEL } from "@/lib/pay-labels";

/**
 * Paying suppliers (A3): from a bank account, office cash, or a cheque we
 * write. One balanced entry each:
 *
 *   Dr Supplier (amount + TDS)   Cr Bank / Office cash / Cheques issued (amount)
 *                                Cr TDS payable (TDS kept back)
 *
 * The payment settles the supplier's bills (the ones picked first, then the
 * oldest); anything left over is an advance that the next bill uses. A cheque
 * sits in "Cheques issued" until our bank pays it (cleared), or is reversed
 * when it bounces or is stopped.
 */

export { CHEQUE_STATUS_LABEL, PAY_METHOD_LABEL, TDS_SECTIONS } from "@/lib/pay-labels";

export type PayInput = {
  supplierId: string;
  date: string;
  method: SupplierPayMethod;
  /** Bank transfer or cheque: which of our bank accounts. Blank = the default bank. */
  bankAccountId?: string | null;
  /** Paise that left us. */
  amount: number;
  /** TDS kept back (paise); the bills are settled by amount + TDS. */
  tds?: number;
  tdsSection?: string | null;
  /** Why the TDS differs from what the app worked out. */
  tdsNote?: string | null;
  /** UTR / transaction reference. */
  reference?: string | null;
  cheque?: { number: string; date?: string | null } | null;
  /** Bills (SupplierBill ids) to settle first, in this order. */
  billIds?: string[];
  note?: string | null;
};

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");
const isPaise = (v: unknown, min: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= 100_000_000_000;
/** Noon IST of a day, or now when that is still ahead. */
const atDay = (day: string) => {
  const t = new Date(`${day}T12:00:00+05:30`);
  return t > new Date() ? new Date() : t;
};

async function bankFor(ctx: Ctx, id: string | null | undefined) {
  const b = id ? await ctx.tx.bankAccount.findUnique({ where: { id } }) : await ctx.tx.bankAccount.findFirst({ where: { isDefault: true } });
  if (!b) throw new MoneyError(id ? "Bank account not found" : "Add a bank account first (Books → Bank accounts)", id ? 404 : 400);
  if (!b.active) throw new MoneyError(`${b.name} is closed`);
  return b;
}

/** Pay a supplier. Returns the payment with its cheque. */
export async function paySupplier(ctx: Ctx, input: PayInput) {
  const supplier = await ctx.tx.supplier.findUnique({
    where: { id: String(input.supplierId) },
  });
  if (!supplier) throw new MoneyError("Supplier not found", 404);
  if (!supplier.active) throw new MoneyError(`${supplier.name} is not in use`);
  await lockSupplier(ctx, supplier.id);
  if (!isDay(input.date)) throw new MoneyError("Enter the payment date");
  if (input.date > todayIst()) throw new MoneyError("The payment date is in the future");
  const method = input.method;
  if (!(method in PAY_METHOD_LABEL)) throw new MoneyError("Choose how it was paid");
  if (!isPaise(input.amount, 1)) throw new MoneyError("Enter the amount paid");
  const tds = input.tds ?? 0;
  if (!isPaise(tds, 0)) throw new MoneyError("TDS must be ₹0 or more");
  const tdsSection = tds ? text(input.tdsSection, 12).toUpperCase() || supplier.tdsSection : null;
  if (tds && !tdsSection) throw new MoneyError("Pick the TDS section (or set it on the supplier)");
  const settles = input.amount + tds;

  const bank = method === "CASH" ? null : await bankFor(ctx, input.bankAccountId);
  const fy = fyCode(dayStart(input.date));
  const number = docNumber("SP", fy, await nextSequence(ctx.tx, ctx.tenantId, `sp:${fy}`));

  let chequeId: string | null = null;
  if (method === "CHEQUE") {
    const no = text(input.cheque?.number, 20);
    if (!/^[0-9A-Za-z-]{3,20}$/.test(no)) throw new MoneyError("Enter the cheque number");
    const cdate = input.cheque?.date || input.date;
    if (!isDay(cdate)) throw new MoneyError("The cheque date must be a date");
    const ch = await ctx.tx.issuedCheque
      .create({
        data: {
          tenantId: ctx.tenantId,
          number: no,
          bankAccountId: bank!.id,
          date: new Date(`${cdate}T00:00:00Z`),
          amount: input.amount,
          payee: supplier.name,
          supplierId: supplier.id,
        },
      })
      .catch((e: unknown) => {
        if ((e as { code?: string })?.code === "P2002") throw new MoneyError(`Cheque ${no} of ${bank!.name} is already entered`, 409);
        throw e;
      });
    chequeId = ch.id;
  }

  const from: AccountRef = method === "CASH" ? { type: "OFFICE_CASH" } : method === "CHEQUE" ? { type: "ISSUED_CHEQUES" } : { type: "BANK", bankAccountId: bank!.id };
  const lines: Line[] = [
    { account: { type: "PAYABLE", supplierId: supplier.id }, amount: settles },
    { account: from, amount: -input.amount },
  ];
  if (tds) lines.push({ account: { type: "TDS_PAYABLE" }, amount: -tds });
  const reference = text(input.reference, 60) || null;
  const entry = await post(ctx, {
    kind: "SUPPLIER_PAYMENT",
    memo: `${number} to ${supplier.name} · ${PAY_METHOD_LABEL[method]}${method === "CHEQUE" ? ` ${text(input.cheque?.number, 20)}` : reference ? ` ${reference}` : ""}${tds ? ` · TDS ${tdsSection}` : ""}`,
    supplierId: supplier.id,
    occurredAt: atDay(input.date),
    lines,
  });

  const credit = await ctx.tx.supplierCredit.create({
    data: {
      tenantId: ctx.tenantId,
      supplierId: supplier.id,
      kind: "PAYMENT",
      number,
      date: atDay(input.date),
      amount: settles,
      entryId: entry.id,
      note: PAY_METHOD_LABEL[method],
    },
  });
  const payment = await ctx.tx.supplierPayment.create({
    data: {
      tenantId: ctx.tenantId,
      number,
      supplierId: supplier.id,
      date: new Date(`${input.date}T00:00:00Z`),
      method,
      bankAccountId: bank?.id ?? null,
      amount: input.amount,
      tds,
      tdsSection,
      tdsNote: tds ? text(input.tdsNote, 200) || null : null,
      reference,
      note: text(input.note, 300) || null,
      creditId: credit.id,
      entryId: entry.id,
      chequeId,
      createdById: ctx.actorId,
    },
  });

  // The bills picked first, in the order given; then the oldest.
  const picked = [...new Set((input.billIds ?? []).map(String))].slice(0, 500);
  if (picked.length) {
    const bills = await ctx.tx.supplierBill.findMany({
      where: { id: { in: picked } },
    });
    let left = settles;
    for (const id of picked) {
      const b = bills.find((x) => x.id === id);
      if (!b || b.supplierId !== supplier.id) throw new MoneyError("A picked bill is not this supplier's", 400);
      const room = b.amount - b.paid;
      if (left <= 0 || room <= 0) continue;
      const amt = Math.min(room, left);
      await ctx.tx.supplierAllocation.create({
        data: {
          tenantId: ctx.tenantId,
          creditId: credit.id,
          billId: b.id,
          amount: amt,
        },
      });
      await ctx.tx.supplierBill.update({
        where: { id: b.id },
        data: { paid: b.paid + amt, settled: b.paid + amt >= b.amount },
      });
      left -= amt;
    }
    await ctx.tx.supplierCredit.update({
      where: { id: credit.id },
      data: { allocated: settles - left },
    });
  }
  await allocateSupplier(ctx, supplier.id);
  return ctx.tx.supplierPayment.findUniqueOrThrow({
    where: { id: payment.id },
    include: { cheque: true, supplier: { select: { name: true } } },
  });
}

/**
 * Undo a payment: entered by mistake, or our cheque bounced / was stopped.
 * The entry is reversed and the bills it settled are open again. A cleared
 * cheque can't be undone this way.
 */
export async function cancelSupplierPayment(ctx: Ctx, id: string, reason: string, as: "CANCELLED" | "BOUNCED" = "CANCELLED") {
  const p = await ctx.tx.supplierPayment.findUnique({
    where: { id },
    include: { cheque: true },
  });
  if (!p) throw new MoneyError("Payment not found", 404);
  if (p.cancelledAt) throw new MoneyError("Already cancelled", 409);
  const why = text(reason, 200);
  if (why.length < 3) throw new MoneyError("Say why");
  if (as === "BOUNCED" && !p.cheque) throw new MoneyError("Only a cheque can bounce");
  if (p.cheque?.status === "CLEARED") throw new MoneyError("Our bank has paid this cheque, so the payment stands. Enter money back from the supplier instead.", 409);
  await lockSupplier(ctx, p.supplierId);
  if (p.creditId) {
    await deallocateCredit(ctx, p.creditId);
    await ctx.tx.supplierCredit.delete({ where: { id: p.creditId } });
  }
  if (p.entryId) await reverseEntry(ctx, p.entryId, `${p.number} ${as === "BOUNCED" ? "bounced" : "cancelled"}: ${why}`);
  if (p.cheque)
    await ctx.tx.issuedCheque.update({
      where: { id: p.cheque.id },
      data: { status: as, reason: why },
    });
  // A bank line that pointed at it is open again.
  await ctx.tx.bankLine.updateMany({
    where: { matchRef: p.id, status: "MATCHED" },
    data: {
      status: "UNMATCHED",
      matchKind: null,
      matchRef: null,
      entryId: null,
      matchedById: null,
      matchedAt: null,
      note: `${p.number} was cancelled`,
    },
  });
  await ctx.tx.supplierPayment.update({
    where: { id: p.id },
    data: { cancelledAt: new Date(), cancelReason: why, creditId: null },
  });
  await allocateSupplier(ctx, p.supplierId);
}

/** Our bank paid a cheque we wrote: Dr Cheques issued, Cr that bank. */
export async function clearIssuedCheque(ctx: Ctx, chequeId: string, day: string = todayIst()) {
  const ch = await ctx.tx.issuedCheque.findUnique({
    where: { id: chequeId },
    include: { bankAccount: true },
  });
  if (!ch) throw new MoneyError("Cheque not found", 404);
  if (ch.status !== "ISSUED") throw new MoneyError(`This cheque is ${CHEQUE_STATUS_LABEL[ch.status].toLowerCase()}`, 409);
  if (!isDay(day) || day > todayIst()) throw new MoneyError("Pick the day the bank paid it");
  const entry = await post(ctx, {
    kind: "ISSUED_CHEQUE_CLEAR",
    memo: `Cheque ${ch.number} to ${ch.payee} paid by ${ch.bankAccount.name}`,
    supplierId: ch.supplierId,
    occurredAt: atDay(day),
    lines: [
      { account: { type: "ISSUED_CHEQUES" }, amount: ch.amount },
      {
        account: { type: "BANK", bankAccountId: ch.bankAccountId },
        amount: -ch.amount,
      },
    ],
  });
  return ctx.tx.issuedCheque.update({
    where: { id: ch.id },
    data: { status: "CLEARED", clearedAt: atDay(day), clearEntryId: entry.id },
  });
}

// ───────────────────────────── reading ─────────────────────────────

export async function paymentDetail(ctx: Ctx, id: string) {
  const p = await ctx.tx.supplierPayment.findUnique({
    where: { id },
    include: {
      supplier: { select: { id: true, name: true, gstin: true } },
      bankAccount: { select: { id: true, name: true } },
      cheque: true,
    },
  });
  if (!p) throw new MoneyError("Payment not found", 404);
  const allocations = p.creditId
    ? await ctx.tx.supplierAllocation.findMany({
        where: { creditId: p.creditId },
        include: {
          bill: {
            select: {
              number: true,
              date: true,
              amount: true,
              purchaseBillId: true,
              kind: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const credit = p.creditId ? await ctx.tx.supplierCredit.findUnique({ where: { id: p.creditId } }) : null;
  const bankLine = await ctx.tx.bankLine.findFirst({
    where: {
      status: "MATCHED",
      OR: [{ matchRef: p.id }, ...(p.chequeId ? [{ matchRef: p.chequeId }] : [])],
    },
    select: { id: true, date: true, narration: true },
  });
  return {
    ...p,
    date: p.date.toISOString().slice(0, 10),
    advance: credit ? credit.amount - credit.allocated : 0,
    bankLine,
    allocations: allocations.map((a) => ({
      id: a.id,
      amount: a.amount,
      bill: { ...a.bill, date: a.bill.date.toISOString().slice(0, 10) },
    })),
  };
}

export async function paymentsList(ctx: Ctx, from: string, to: string, f: { supplierId?: string | null; method?: SupplierPayMethod | null } = {}) {
  const rows = await ctx.tx.supplierPayment.findMany({
    where: {
      date: {
        gte: new Date(`${from}T00:00:00Z`),
        lte: new Date(`${to}T00:00:00Z`),
      },
      ...(f.supplierId ? { supplierId: f.supplierId } : {}),
      ...(f.method ? { method: f.method } : {}),
    },
    include: {
      supplier: { select: { name: true } },
      bankAccount: { select: { name: true } },
      cheque: { select: { number: true, status: true } },
    },
    orderBy: [{ date: "asc" }, { number: "asc" }],
    take: 3000,
  });
  const live = rows.filter((r) => !r.cancelledAt);
  const byMethod = (m: SupplierPayMethod) => live.filter((r) => r.method === m).reduce((a, r) => a + r.amount, 0);
  return {
    from,
    to,
    rows: rows.map((r) => ({
      id: r.id,
      number: r.number,
      date: r.date.toISOString().slice(0, 10),
      supplierId: r.supplierId,
      supplier: r.supplier.name,
      method: r.method,
      via: r.method === "CASH" ? "Office cash" : `${r.bankAccount?.name ?? ""}${r.cheque ? ` · cheque ${r.cheque.number}` : r.reference ? ` · ${r.reference}` : ""}`,
      chequeStatus: r.cheque?.status ?? null,
      amount: r.amount,
      tds: r.tds,
      tdsSection: r.tdsSection,
      cancelled: !!r.cancelledAt,
    })),
    totals: {
      paid: live.reduce((a, r) => a + r.amount, 0),
      tds: live.reduce((a, r) => a + r.tds, 0),
      bank: byMethod("BANK"),
      cash: byMethod("CASH"),
      cheque: byMethod("CHEQUE"),
    },
    capped: rows.length >= 3000,
  };
}

/** Cheques we wrote, newest first (status filter optional). */
export async function issuedCheques(ctx: Ctx, status?: IssuedChequeStatus | null) {
  const rows = await ctx.tx.issuedCheque.findMany({
    where: status ? { status } : {},
    include: {
      bankAccount: { select: { name: true } },
      payment: { select: { id: true, number: true } },
    },
    orderBy: [{ status: "asc" }, { date: "desc" }],
    take: 500,
  });
  return rows.map((c) => ({
    id: c.id,
    number: c.number,
    date: c.date.toISOString().slice(0, 10),
    amount: c.amount,
    payee: c.payee,
    supplierId: c.supplierId,
    bank: c.bankAccount.name,
    status: c.status,
    clearedAt: c.clearedAt,
    reason: c.reason,
    payment: c.payment,
  }));
}

/** What the payment form needs. */
export async function payOptions(ctx: Ctx) {
  const [banks, suppliers] = await Promise.all([
    ctx.tx.bankAccount.findMany({
      where: { active: true },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      select: { id: true, name: true, isDefault: true },
    }),
    ctx.tx.supplier.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        kind: true,
        tdsSection: true,
        bankName: true,
        bankAccountNo: true,
        bankIfsc: true,
      },
    }),
  ]);
  return { banks, suppliers };
}

// ───────────────────────────── payables reports ─────────────────────────────

export type AgeBucket = "notDue" | "d30" | "d60" | "d90" | "older";
export const AGE_LABEL: Record<AgeBucket, string> = {
  notDue: "Not due",
  d30: "1–30 days late",
  d60: "31–60",
  d90: "61–90",
  older: "Over 90",
};
const DAY = 86_400_000;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

/**
 * Every supplier bill still open on a day: what was left after the notes,
 * advances and payments dated up to then, with how late it is.
 */
export async function openBillsOn(ctx: Ctx, asOn: string, f: { supplierId?: string | null } = {}) {
  const end = dayEnd(asOn);
  const bills = await ctx.tx.supplierBill.findMany({
    where: {
      date: { lte: new Date(`${asOn}T00:00:00Z`) },
      ...(f.supplierId ? { supplierId: f.supplierId } : {}),
    },
    include: {
      supplier: { select: { name: true } },
      allocations: {
        select: { amount: true, credit: { select: { date: true } } },
      },
    },
    orderBy: [{ dueDate: "asc" }, { date: "asc" }],
  });
  const out = [];
  for (const b of bills) {
    const viaCredits = b.allocations.reduce((a, x) => a + x.amount, 0);
    const before = b.allocations.filter((x) => x.credit.date <= end).reduce((a, x) => a + x.amount, 0);
    // Opening bills carry what the old books had paid.
    const left = b.amount - (b.paid - viaCredits) - before;
    if (left <= 0) continue;
    const date = b.date.toISOString().slice(0, 10);
    const due = b.dueDate.toISOString().slice(0, 10);
    const late = daysBetween(due, asOn);
    const bucket: AgeBucket = late <= 0 ? "notDue" : late <= 30 ? "d30" : late <= 60 ? "d60" : late <= 90 ? "d90" : "older";
    out.push({
      id: b.id,
      supplierId: b.supplierId,
      supplier: b.supplier.name,
      number: b.number,
      kind: b.kind,
      purchaseBillId: b.purchaseBillId,
      date,
      dueDate: due,
      amount: b.amount,
      left,
      age: daysBetween(date, asOn),
      late: Math.max(0, late),
      bucket,
    });
  }
  return out;
}

/** Supplier-wise: what we owe each one on a day (their ledger), split by how late their bills are. */
export async function payablesBySupplier(ctx: Ctx, asOn: string, f: { supplierId?: string | null } = {}) {
  const end = dayEnd(asOn);
  const [bills, accounts, suppliers] = await Promise.all([
    openBillsOn(ctx, asOn, f),
    ctx.tx.ledgerAccount.findMany({
      where: {
        type: "PAYABLE",
        supplierId: f.supplierId ? f.supplierId : { not: null },
      },
      select: { id: true, supplierId: true },
    }),
    ctx.tx.supplier.findMany({
      where: f.supplierId ? { id: f.supplierId } : {},
      select: { id: true, name: true, gstin: true, phone: true },
    }),
  ]);
  const sums = accounts.length
    ? await ctx.tx.ledgerLine.groupBy({
        by: ["accountId"],
        where: {
          accountId: { in: accounts.map((a) => a.id) },
          entry: { occurredAt: { lte: end } },
        },
        _sum: { amount: true },
      })
    : [];
  const byAcc = new Map(sums.map((s) => [s.accountId, Number(s._sum.amount ?? 0)]));
  type Row = {
    id: string;
    name: string;
    gstin: string | null;
    phone: string | null;
    owed: number;
    bills: number;
  } & Record<AgeBucket, number>;
  const rows: Row[] = [];
  for (const s of suppliers) {
    const owed = -accounts.filter((a) => a.supplierId === s.id).reduce((a, x) => a + (byAcc.get(x.id) ?? 0), 0);
    const mine = bills.filter((b) => b.supplierId === s.id);
    if (!owed && !mine.length) continue;
    const by = (k: AgeBucket) => mine.filter((b) => b.bucket === k).reduce((a, b) => a + b.left, 0);
    rows.push({
      id: s.id,
      name: s.name,
      gstin: s.gstin,
      phone: s.phone,
      owed,
      bills: mine.length,
      notDue: by("notDue"),
      d30: by("d30"),
      d60: by("d60"),
      d90: by("d90"),
      older: by("older"),
    });
  }
  rows.sort((a, b) => b.owed - a.owed);
  const sum = (k: "owed" | AgeBucket) => rows.reduce((a, r) => a + r[k], 0);
  return {
    asOn,
    rows,
    totals: {
      owed: sum("owed"),
      notDue: sum("notDue"),
      d30: sum("d30"),
      d60: sum("d60"),
      d90: sum("d90"),
      older: sum("older"),
    },
  };
}

/** Bills to pay soon: late already, or due within `days` of the day. */
export async function billsFallingDue(ctx: Ctx, asOn: string, days = 7, f: { supplierId?: string | null } = {}) {
  const limit = new Date(Date.parse(`${asOn}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
  const bills = (await openBillsOn(ctx, asOn, f)).filter((b) => b.dueDate <= limit);
  return {
    asOn,
    until: limit,
    overdue: bills.filter((b) => b.dueDate < asOn),
    soon: bills.filter((b) => b.dueDate >= asOn),
    totals: {
      overdue: bills.filter((b) => b.dueDate < asOn).reduce((a, b) => a + b.left, 0),
      soon: bills.filter((b) => b.dueDate >= asOn).reduce((a, b) => a + b.left, 0),
    },
  };
}
