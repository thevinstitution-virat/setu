import type { AccountGroup, AccountType, EntryKind, VoucherLineRole } from "@/generated/prisma/client";
import { balanceOf, GROUP_OF, MoneyError, NAMES, post, recordHandover, reverseEntry, type AccountRef, type Ctx } from "@/lib/ledger";
import { docNumber, fyCode, validGstin } from "@/lib/gst";
import { nextSequence } from "@/lib/orders";
import { accountLedger, dayStart, ensureBooks, GROUPS, isDay, todayIst } from "@/lib/books";
import { keyBelongsTo } from "@/lib/storage";
import { formatINR } from "@/lib/money";
import { TDS_SECTIONS } from "@/lib/pay-labels";
import { isVoucherMethod, isVoucherType, JOURNAL_BUILT_INS, VOUCHER_METHOD_LABEL, VOUCHER_PREFIX, VOUCHER_TYPE_LABEL, type VoucherMethod, type VoucherType } from "@/lib/voucher-labels";

/**
 * Vouchers (A5): the money that is neither a shop's nor a supplier's.
 *
 *   Payment (PV)  Dr head(s) [+ Dr GST input]          Cr cash / bank / our cheque / staff cash [+ Cr TDS payable]
 *   Receipt (RV)  Dr cash / bank [+ Dr TDS deducted]   Cr head(s)
 *   Contra  (CV)  Dr the cash or bank it went to       Cr the cash, bank or staff cash it came from
 *   Journal (JV)  any balanced lines, with a reason
 *
 * Each voucher keeps its lines exactly as posted, so the books check can
 * prove the ledger and the vouchers agree. A wrong voucher is cancelled (its
 * entry reversed) and entered again.
 */

export { VOUCHER_METHOD_LABEL, VOUCHER_TYPE_LABEL } from "@/lib/voucher-labels";

export type VoucherLineInput = { code: string; amount: number; note?: string | null };

export type VoucherInput = {
  type: VoucherType;
  date: string;
  /** Payment / receipt. */
  method?: VoucherMethod | null;
  /** Cash: which cash account (office cash or a cash head). Blank = office cash. */
  cashCode?: string | null;
  /** Bank / cheque: which bank account. Blank = the default bank. */
  bankAccountId?: string | null;
  /** Staff: who paid from the cash they collected. */
  staffUserId?: string | null;
  /** Payment / receipt: positive amounts per head. Journal: debit positive, credit negative. */
  lines?: VoucherLineInput[];
  /** Contra. */
  fromCode?: string | null;
  toCode?: string | null;
  amount?: number;
  party?: string | null;
  partyGstin?: string | null;
  gst?: number;
  tds?: number;
  tdsSection?: string | null;
  /** Why the TDS differs from what the app worked out. */
  tdsNote?: string | null;
  /** The party's PAN (for the TDS return). */
  partyPan?: string | null;
  reference?: string | null;
  narration?: string | null;
  photos?: string[];
  cheque?: { number: string; date?: string | null } | null;
};

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");
const MAX = 100_000_000_000;
const isPaise = (v: unknown, min: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= MAX;
/** Noon IST of a day, or now when that is still ahead. */
const atDay = (day: string) => {
  const t = new Date(`${day}T12:00:00+05:30`);
  return t > new Date() ? new Date() : t;
};

// ───────────────────────────── accounts ─────────────────────────────

type AccKind = "head" | "cash" | "bank" | "staff" | "builtin";
type Acc = { ref: AccountRef; code: string; name: string; kind: AccKind; group: AccountGroup; active: boolean };

function builtIn(type: Exclude<AccountType, "HEAD" | "BANK">): Acc {
  return { ref: { type }, code: type, name: NAMES[type], kind: "builtin", group: GROUP_OF[type], active: true };
}

/** The account behind a ledger code a voucher line may use. */
async function account(ctx: Ctx, raw: unknown): Promise<Acc> {
  const code = typeof raw === "string" ? raw.trim() : "";
  if (!code) throw new MoneyError("Pick the account for every line");
  if (code.startsWith("HEAD:")) {
    const h = await ctx.tx.ledgerHead.findUnique({ where: { id: code.slice(5) } });
    if (!h) throw new MoneyError("Account head not found", 404);
    return { ref: { type: "HEAD", headId: h.id }, code, name: h.name, kind: h.group === "CASH" ? "cash" : "head", group: h.group, active: h.active };
  }
  if (code === "OFFICE_CASH") return { ...builtIn("OFFICE_CASH"), kind: "cash" };
  if (code.startsWith("STAFF_CASH:")) {
    const u = await ctx.tx.user.findUnique({ where: { id: code.slice(11) }, select: { id: true, name: true } });
    if (!u) throw new MoneyError("Staff member not found", 404);
    return { ref: { type: "STAFF_CASH", userId: u.id }, code, name: `Cash with ${u.name}`, kind: "staff", group: "CASH", active: true };
  }
  const bank = await ctx.tx.bankAccount.findFirst({ where: { ledgerCode: code } });
  if (bank) return { ref: { type: "BANK", bankAccountId: bank.id }, code, name: bank.name, kind: "bank", group: "BANK", active: bank.active };
  // A business that never opened its books has one bank, as before bank accounts.
  if (code === "BANK" && !(await ctx.tx.bankAccount.count())) return { ref: { type: "BANK" }, code, name: NAMES.BANK, kind: "bank", group: "BANK", active: true };
  if ((JOURNAL_BUILT_INS as readonly string[]).includes(code)) return builtIn(code as (typeof JOURNAL_BUILT_INS)[number]);
  throw new MoneyError("That account is kept by its own bills and payments, so a voucher can't post to it", 400);
}

/** A bank account (blank = the default one) as a voucher account. */
async function bankAcc(ctx: Ctx, id: string | null | undefined): Promise<Acc & { bankAccountId: string | null }> {
  const b = id ? await ctx.tx.bankAccount.findUnique({ where: { id } }) : await ctx.tx.bankAccount.findFirst({ where: { isDefault: true } });
  if (id && !b) throw new MoneyError("Bank account not found", 404);
  if (b) {
    if (!b.active) throw new MoneyError(`${b.name} is closed`);
    return { ref: { type: "BANK", bankAccountId: b.id }, code: b.ledgerCode, name: b.name, kind: "bank", group: "BANK", active: true, bankAccountId: b.id };
  }
  if (await ctx.tx.bankAccount.count()) throw new MoneyError("Pick the bank account");
  return { ref: { type: "BANK" }, code: "BANK", name: NAMES.BANK, kind: "bank", group: "BANK", active: true, bankAccountId: null };
}

const lockStaffCash = (ctx: Ctx, userId: string) => ctx.tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${ctx.tenantId}:cash:${userId}`}))`;

/** Staff cash can only pay what the person holds. */
async function staffCan(ctx: Ctx, userId: string, amount: number, name: string) {
  await lockStaffCash(ctx, userId);
  const held = await balanceOf(ctx, { type: "STAFF_CASH", userId });
  if (amount > held) throw new MoneyError(`${name} holds only ${formatINR(held)} of collected cash`);
}

function cleanPhotos(ctx: Ctx, v: unknown) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new MoneyError("Photos must be a list");
  const keys = [...new Set(v.map(String))];
  if (keys.length > 6) throw new MoneyError("At most 6 photos");
  for (const k of keys) if (!keyBelongsTo(k, ctx.tenantId) || k.split("/")[2] !== "voucher-slip") throw new MoneyError("A photo is not one of ours", 400);
  return keys;
}

// ───────────────────────────── entering ─────────────────────────────

type Posted = { acc: Acc; amount: number; role: VoucherLineRole; note: string | null };
const KIND: Record<VoucherType, EntryKind> = { PAYMENT: "VOUCHER_PAYMENT", RECEIPT: "VOUCHER_RECEIPT", CONTRA: "CONTRA", JOURNAL: "JOURNAL" };

/** Enter a voucher: validated, numbered, posted and stored with its lines, in one go. */
export async function createVoucher(ctx: Ctx, input: VoucherInput, extra: { handoverId?: string | null } = {}) {
  const type = input?.type;
  if (!isVoucherType(type)) throw new MoneyError("Choose the kind of voucher");
  if (!isDay(input.date)) throw new MoneyError("Enter the date");
  if (input.date > todayIst()) throw new MoneyError("The date is in the future");
  const narration = text(input.narration, 300) || null;
  const party = text(input.party, 100) || null;
  const reference = text(input.reference, 60) || null;
  const photos = cleanPhotos(ctx, input.photos);

  const lines: Posted[] = [];
  let method: VoucherMethod | null = null;
  let bankAccountId: string | null = null;
  let staffUserId: string | null = null;
  let amount = 0;
  let gst = 0;
  let tds = 0;
  let tdsSection: string | null = null;
  let partyGstin: string | null = null;
  let partyPan: string | null = null;
  let cheque: { number: string; date: string } | null = null;

  if (type === "PAYMENT" || type === "RECEIPT") {
    const pay = type === "PAYMENT";
    if (!isVoucherMethod(input.method)) throw new MoneyError(`Choose how the money was ${pay ? "paid" : "received"}`);
    method = input.method;
    if (!pay && (method === "CHEQUE" || method === "STAFF")) throw new MoneyError("A receipt comes into cash or a bank");
    const raw = (input.lines ?? []).filter((l) => l && (l.code || l.amount));
    if (!raw.length) throw new MoneyError("Add a line: what it was for and how much");
    if (raw.length > 50) throw new MoneyError("At most 50 lines");
    let sum = 0;
    for (const l of raw) {
      const acc = await account(ctx, l.code);
      if (acc.kind === "cash" || acc.kind === "bank" || acc.kind === "staff")
        throw new MoneyError(`${acc.name} is cash or a bank: money between them is a contra, not a ${pay ? "payment" : "receipt"}`);
      if (acc.kind !== "head") throw new MoneyError("Pick one of your heads (rent, fuel, capital …) for every line");
      if (!isPaise(l.amount, 1)) throw new MoneyError(`Enter the amount for ${acc.name}`);
      sum += l.amount;
      lines.push({ acc, amount: pay ? l.amount : -l.amount, role: "ACCOUNT", note: text(l.note, 120) || null });
    }
    gst = pay ? (input.gst ?? 0) : 0;
    if (!isPaise(gst, 0)) throw new MoneyError("GST must be ₹0 or more");
    partyGstin = text(input.partyGstin, 15).toUpperCase() || null;
    if (partyGstin && !validGstin(partyGstin)) throw new MoneyError("That GSTIN doesn't look right");
    if (gst && !partyGstin) throw new MoneyError("GST input credit needs the seller's GSTIN");
    partyPan = text(input.partyPan, 10).toUpperCase() || (partyGstin ? partyGstin.slice(2, 12) : null);
    if (partyPan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(partyPan)) throw new MoneyError("That PAN doesn't look right (like ABCDE1234F)");
    tds = input.tds ?? 0;
    if (!isPaise(tds, 0)) throw new MoneyError("TDS must be ₹0 or more");
    tdsSection = tds ? text(input.tdsSection, 12).toUpperCase() || null : null;
    if (tds && !tdsSection) throw new MoneyError("Pick the TDS section");
    amount = sum + gst - tds;
    if (amount <= 0) throw new MoneyError("The TDS is more than the amount");
    if (gst) lines.push({ acc: builtIn("GST_INPUT"), amount: gst, role: "GST", note: partyGstin });
    if (tds) lines.push({ acc: builtIn(pay ? "TDS_PAYABLE" : "TDS_RECEIVABLE"), amount: pay ? -tds : tds, role: "TDS", note: tdsSection });

    let money: Acc;
    if (method === "CASH") {
      money = await account(ctx, input.cashCode || "OFFICE_CASH");
      if (money.kind !== "cash") throw new MoneyError("Pick office cash or a cash head");
    } else if (method === "STAFF") {
      const u = input.staffUserId ? await ctx.tx.user.findUnique({ where: { id: String(input.staffUserId) }, select: { id: true, name: true } }) : null;
      if (!u) throw new MoneyError("Choose who paid it", 400);
      await staffCan(ctx, u.id, amount, u.name);
      staffUserId = u.id;
      money = await account(ctx, `STAFF_CASH:${u.id}`);
    } else {
      const b = await bankAcc(ctx, input.bankAccountId);
      bankAccountId = b.bankAccountId;
      money = b;
      if (method === "CHEQUE") {
        if (!bankAccountId) throw new MoneyError("Add a bank account first (Books → Bank accounts)");
        const no = text(input.cheque?.number, 20);
        if (!/^[0-9A-Za-z-]{3,20}$/.test(no)) throw new MoneyError("Enter the cheque number");
        const cdate = input.cheque?.date || input.date;
        if (!isDay(cdate)) throw new MoneyError("The cheque date must be a date");
        if (!party) throw new MoneyError("Write who the cheque is to");
        cheque = { number: no, date: cdate };
        money = builtIn("ISSUED_CHEQUES");
      }
    }
    lines.push({ acc: money, amount: pay ? -amount : amount, role: "MONEY", note: null });
  } else if (type === "CONTRA") {
    const from = await account(ctx, input.fromCode);
    const to = await account(ctx, input.toCode);
    if (!["cash", "bank", "staff"].includes(from.kind)) throw new MoneyError("A contra moves money from cash, a bank or a staff member's collected cash");
    if (to.kind !== "cash" && to.kind !== "bank") throw new MoneyError("A contra moves money into cash or a bank");
    if (from.code === to.code) throw new MoneyError("Pick two different accounts");
    if (!isPaise(input.amount, 1)) throw new MoneyError("Enter the amount moved");
    amount = input.amount!;
    if (from.kind === "staff") {
      staffUserId = from.ref.userId!;
      await staffCan(ctx, staffUserId, amount, from.name.replace(/^Cash with /, ""));
    }
    bankAccountId = to.ref.bankAccountId ?? from.ref.bankAccountId ?? null;
    lines.push({ acc: to, amount, role: "MONEY", note: null }, { acc: from, amount: -amount, role: "MONEY", note: null });
  } else {
    if (!narration || narration.length < 3) throw new MoneyError("Write the reason for this journal");
    const raw = (input.lines ?? []).filter((l) => l && (l.code || l.amount));
    if (raw.length < 2) throw new MoneyError("A journal needs at least two lines");
    if (raw.length > 50) throw new MoneyError("At most 50 lines");
    let debit = 0;
    let credit = 0;
    for (const l of raw) {
      const acc = await account(ctx, l.code);
      if (acc.kind === "staff") throw new MoneyError("Staff cash moves by handovers and staff expenses, not a journal");
      if (!Number.isInteger(l.amount) || l.amount === 0 || Math.abs(l.amount) > MAX) throw new MoneyError(`Enter a debit or a credit for ${acc.name}`);
      if (l.amount > 0) debit += l.amount;
      else credit -= l.amount;
      lines.push({ acc, amount: l.amount, role: "ACCOUNT", note: text(l.note, 120) || null });
    }
    if (debit !== credit) throw new MoneyError(`Debits (${formatINR(debit)}) and credits (${formatINR(credit)}) must be equal`);
    amount = debit;
  }

  const prefix = VOUCHER_PREFIX[type];
  const fy = fyCode(dayStart(input.date));
  const number = docNumber(prefix, fy, await nextSequence(ctx.tx, ctx.tenantId, `${prefix.toLowerCase()}:${fy}`));

  let chequeId: string | null = null;
  if (cheque) {
    const ch = await ctx.tx.issuedCheque
      .create({ data: { tenantId: ctx.tenantId, number: cheque.number, bankAccountId: bankAccountId!, date: new Date(`${cheque.date}T00:00:00Z`), amount, payee: party! } })
      .catch((e: unknown) => {
        if ((e as { code?: string })?.code === "P2002") throw new MoneyError(`Cheque ${cheque!.number} of this bank is already entered`, 409);
        throw e;
      });
    chequeId = ch.id;
  }

  const heads = [...new Set(lines.filter((l) => l.role === "ACCOUNT").map((l) => l.acc.name))];
  const money = lines.find((l) => l.role === "MONEY");
  const what =
    type === "CONTRA" ? `${lines[1].acc.name} to ${lines[0].acc.name}` : type === "JOURNAL" ? narration! : `${heads.slice(0, 2).join(", ")}${heads.length > 2 ? "…" : ""}${party ? ` · ${party}` : ""}`;
  const via = method === "CHEQUE" ? ` · cheque ${cheque!.number}` : method === "STAFF" ? ` · paid by ${money!.acc.name.replace(/^Cash with /, "")}` : reference ? ` · ${reference}` : "";
  const entry = await post(ctx, {
    kind: KIND[type],
    memo: `${number} ${what}${via}`.slice(0, 300),
    occurredAt: atDay(input.date),
    lines: lines.map((l) => ({ account: l.acc.ref, amount: l.amount })),
  });

  return ctx.tx.voucher.create({
    data: {
      tenantId: ctx.tenantId,
      number,
      type,
      date: new Date(`${input.date}T00:00:00Z`),
      method,
      bankAccountId,
      staffUserId,
      handoverId: extra.handoverId ?? null,
      amount,
      party,
      partyGstin,
      gst,
      tds,
      tdsSection,
      tdsNote: tds ? text(input.tdsNote, 200) || null : null,
      partyPan: partyPan,
      reference,
      narration,
      photos,
      entryId: entry.id,
      chequeId,
      createdById: ctx.actorId,
      lines: { create: lines.map((l, i) => ({ tenantId: ctx.tenantId, sl: i + 1, role: l.role, code: l.acc.code, name: l.acc.name, amount: l.amount, note: l.note })) },
    },
    include: { lines: { orderBy: { sl: "asc" } } },
  });
}

/**
 * Cancel a voucher: its entry is reversed, a cheque on it is cancelled and a
 * bank line matched to it is open again. A cheque our bank already paid
 * can't be undone this way.
 */
export async function cancelVoucher(ctx: Ctx, id: string, reason: string) {
  const v = await ctx.tx.voucher.findUnique({ where: { id }, include: { cheque: true } });
  if (!v) throw new MoneyError("Voucher not found", 404);
  if (v.cancelledAt) throw new MoneyError("Already cancelled", 409);
  const why = text(reason, 200);
  if (why.length < 3) throw new MoneyError("Say why");
  if (v.cheque?.status === "CLEARED") throw new MoneyError(`Our bank has paid cheque ${v.cheque.number}, so the voucher stands. Enter the money coming back as a receipt instead.`, 409);
  if (v.staffUserId) await lockStaffCash(ctx, v.staffUserId);
  if (v.entryId) await reverseEntry(ctx, v.entryId, `${v.number} cancelled: ${why}`);
  if (v.cheque && v.cheque.status === "ISSUED") await ctx.tx.issuedCheque.update({ where: { id: v.cheque.id }, data: { status: "CANCELLED", reason: why } });
  await ctx.tx.bankLine.updateMany({
    where: { matchRef: v.id, status: "MATCHED" },
    data: { status: "UNMATCHED", matchKind: null, matchRef: null, entryId: null, matchedById: null, matchedAt: null, note: `${v.number} was cancelled` },
  });
  if (v.handoverId) {
    const h = await ctx.tx.cashHandover.findUnique({ where: { id: v.handoverId }, select: { expenses: true } });
    if (h) await ctx.tx.cashHandover.update({ where: { id: v.handoverId }, data: { expenses: Math.max(0, h.expenses - v.amount) } });
  }
  return ctx.tx.voucher.update({ where: { id: v.id }, data: { cancelledAt: new Date(), cancelReason: why } });
}

// ───────────────────────────── staff expenses at a handover ─────────────────────────────

export type ExpenseLine = { headId: string; amount: number; note?: string | null };

/**
 * Receive a staff member's cash. Expenses they paid from it (fuel, toll,
 * loading) go in first as one payment voucher (Dr head, Cr their cash), so
 * what is left short is only the real shortage.
 */
export async function handoverWithExpenses(ctx: Ctx, h: { staffUserId: string; counted: number; note?: string; expenses?: ExpenseLine[]; photos?: string[]; reference?: string | null }) {
  const exp = (h.expenses ?? []).filter((e) => e && (e.headId || e.amount));
  let voucher: Awaited<ReturnType<typeof createVoucher>> | null = null;
  if (exp.length) {
    voucher = await createVoucher(ctx, {
      type: "PAYMENT",
      date: todayIst(),
      method: "STAFF",
      staffUserId: h.staffUserId,
      lines: exp.map((e) => ({ code: `HEAD:${String(e.headId)}`, amount: e.amount, note: e.note })),
      photos: h.photos,
      reference: h.reference,
      narration: "Paid from collected cash, entered at the handover",
    });
  } else if (h.photos?.length) throw new MoneyError("Add the expense the slip is for");
  const handover = await recordHandover(ctx, { staffUserId: h.staffUserId, counted: h.counted, note: h.note });
  if (voucher) {
    await ctx.tx.voucher.update({ where: { id: voucher.id }, data: { handoverId: handover.id } });
    await ctx.tx.cashHandover.update({ where: { id: handover.id }, data: { expenses: voucher.amount } });
  }
  return { handover: { ...handover, expenses: voucher?.amount ?? 0 }, voucher };
}

// ───────────────────────────── reading ─────────────────────────────

/** Heads, cash, banks, staff and built-ins the voucher forms offer. */
export async function voucherOptions(ctx: Ctx) {
  await ensureBooks(ctx);
  const [heads, banks, staff] = await Promise.all([
    ctx.tx.ledgerHead.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    ctx.tx.bankAccount.findMany({ where: { active: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] }),
    ctx.tx.user.findMany({ where: { role: { in: ["DELIVERY_AGENT", "SALES_AGENT"] } }, select: { id: true, name: true, active: true }, orderBy: { name: "asc" } }),
  ]);
  const held = await ctx.tx.$queryRaw<{ userId: string; total: bigint }[]>`
    SELECT a."userId", COALESCE(SUM(l.amount), 0)::bigint AS total FROM "LedgerAccount" a JOIN "LedgerLine" l ON l."accountId" = a.id
    WHERE a.type = 'STAFF_CASH' GROUP BY a."userId"`;
  const heldBy = new Map(held.map((h) => [h.userId, Number(h.total)]));
  const head = (h: (typeof heads)[number]) => ({ code: `HEAD:${h.id}`, name: h.name, group: h.group, groupLabel: GROUPS[h.group].label, key: h.key });
  const cash = [{ code: "OFFICE_CASH", name: NAMES.OFFICE_CASH }, ...heads.filter((h) => h.group === "CASH").map((h) => ({ code: `HEAD:${h.id}`, name: h.name }))];
  const bankRows = banks.map((b) => ({ id: b.id, code: b.ledgerCode, name: b.name, isDefault: b.isDefault }));
  return {
    heads: heads.filter((h) => h.group !== "CASH").map(head),
    cash,
    banks: bankRows,
    staff: staff.map((s) => ({ id: s.id, name: s.name, code: `STAFF_CASH:${s.id}`, held: heldBy.get(s.id) ?? 0 })).filter((s) => s.held > 0 || staff.find((x) => x.id === s.id)?.active),
    journal: [
      ...heads.map((h) => ({ code: `HEAD:${h.id}`, name: h.name, groupLabel: GROUPS[h.group].label })),
      { code: "OFFICE_CASH", name: NAMES.OFFICE_CASH, groupLabel: GROUPS.CASH.label },
      ...bankRows.map((b) => ({ code: b.code, name: b.name, groupLabel: GROUPS.BANK.label })),
      ...JOURNAL_BUILT_INS.map((t) => ({ code: t, name: NAMES[t], groupLabel: GROUPS[GROUP_OF[t]].label })),
    ].sort((a, b) => a.groupLabel.localeCompare(b.groupLabel) || a.name.localeCompare(b.name)),
    tdsSections: TDS_SECTIONS,
  };
}

export type VoucherFilter = { type?: VoucherType | null; q?: string | null };
const LIST_CAP = 3000;

/** Vouchers in a period with what each was for, and totals by kind (cancelled ones shown, not counted). */
export async function voucherList(ctx: Ctx, from: string, to: string, f: VoucherFilter = {}) {
  const q = text(f.q, 60);
  const rows = await ctx.tx.voucher.findMany({
    where: {
      date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) },
      ...(f.type ? { type: f.type } : {}),
      ...(q
        ? {
            OR: [
              { number: { contains: q, mode: "insensitive" } },
              { party: { contains: q, mode: "insensitive" } },
              { narration: { contains: q, mode: "insensitive" } },
              { reference: { contains: q, mode: "insensitive" } },
              { lines: { some: { name: { contains: q, mode: "insensitive" } } } },
            ],
          }
        : {}),
    },
    include: { lines: { select: { role: true, name: true, amount: true }, orderBy: { sl: "asc" } } },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    take: LIST_CAP + 1,
  });
  const used = rows.slice(0, LIST_CAP);
  const totals = { PAYMENT: 0, RECEIPT: 0, CONTRA: 0, JOURNAL: 0 } as Record<VoucherType, number>;
  const counts = { PAYMENT: 0, RECEIPT: 0, CONTRA: 0, JOURNAL: 0 } as Record<VoucherType, number>;
  const out = used.map((v) => {
    const accounts = v.lines.filter((l) => l.role === "ACCOUNT");
    const money = v.lines.filter((l) => l.role === "MONEY");
    if (!v.cancelledAt) {
      totals[v.type] += v.amount;
      counts[v.type] += 1;
    }
    const names = (ls: typeof accounts) => [...new Set(ls.map((l) => l.name))].join(", ");
    const what =
      v.type === "CONTRA"
        ? `${money.find((l) => l.amount < 0)?.name ?? ""} → ${money.find((l) => l.amount > 0)?.name ?? ""}`
        : v.type === "JOURNAL"
          ? `${names(accounts.filter((l) => l.amount > 0))} / ${names(accounts.filter((l) => l.amount < 0))}`
          : names(accounts);
    return {
      id: v.id,
      number: v.number,
      type: v.type,
      date: v.date.toISOString().slice(0, 10),
      method: v.method,
      party: v.party,
      what,
      via: v.type === "PAYMENT" || v.type === "RECEIPT" ? (money[0]?.name ?? "") : "",
      narration: v.narration,
      amount: v.amount,
      gst: v.gst,
      tds: v.tds,
      cancelled: !!v.cancelledAt,
    };
  });
  return { from, to, type: f.type ?? null, q: q || null, rows: out, totals, counts, capped: rows.length > LIST_CAP };
}

export async function voucherDetail(ctx: Ctx, id: string) {
  const v = await ctx.tx.voucher.findUnique({
    where: { id },
    include: { lines: { orderBy: { sl: "asc" } }, bankAccount: { select: { id: true, name: true } }, cheque: true },
  });
  if (!v) throw new MoneyError("Voucher not found", 404);
  const people = [v.createdById, v.staffUserId].filter((x): x is string => !!x);
  const users = people.length ? await ctx.tx.user.findMany({ where: { id: { in: people } }, select: { id: true, name: true } }) : [];
  const name = (uid: string | null) => users.find((u) => u.id === uid)?.name ?? null;
  const bankLines = await ctx.tx.bankLine.findMany({
    where: { status: "MATCHED", OR: [{ matchRef: v.id }, ...(v.chequeId ? [{ matchRef: v.chequeId }] : [])] },
    select: { id: true, date: true, narration: true, debit: true, credit: true, statement: { select: { bankAccount: { select: { name: true } } } } },
  });
  const reversal = v.entryId ? await ctx.tx.journalEntry.findFirst({ where: { reversesId: v.entryId }, select: { occurredAt: true } }) : null;
  return {
    ...v,
    date: v.date.toISOString().slice(0, 10),
    typeLabel: VOUCHER_TYPE_LABEL[v.type],
    methodLabel: v.method ? VOUCHER_METHOD_LABEL[v.method] : null,
    createdBy: name(v.createdById),
    staffName: name(v.staffUserId),
    reversedAt: reversal?.occurredAt ?? null,
    bankLines: bankLines.map((b) => ({ id: b.id, date: b.date.toISOString().slice(0, 10), narration: b.narration, amount: b.debit || b.credit, bank: b.statement.bankAccount?.name ?? null })),
  };
}

// ───────────────────────────── cash book and bank book ─────────────────────────────

/** Accounts the cash and bank book can open: cash, staff cash, and every bank account. */
export async function cashBookChoices(ctx: Ctx) {
  const [heads, banks, staff] = await Promise.all([
    ctx.tx.ledgerHead.findMany({ where: { group: "CASH" }, orderBy: { name: "asc" } }),
    ctx.tx.bankAccount.findMany({ orderBy: [{ isDefault: "desc" }, { name: "asc" }] }),
    ctx.tx.ledgerAccount.findMany({ where: { type: "STAFF_CASH" }, select: { code: true, userId: true } }),
  ]);
  const users = staff.length ? await ctx.tx.user.findMany({ where: { id: { in: staff.map((s) => s.userId!).filter(Boolean) } }, select: { id: true, name: true } }) : [];
  return {
    cash: [{ code: "OFFICE_CASH", name: NAMES.OFFICE_CASH }, ...heads.map((h) => ({ code: `HEAD:${h.id}`, name: `${h.name}${h.active ? "" : " (hidden)"}` }))],
    banks: banks.map((b) => ({ code: b.ledgerCode, name: `${b.name}${b.active ? "" : " (closed)"}` })),
    staff: staff.map((s) => ({ code: s.code, name: `Cash with ${users.find((u) => u.id === s.userId)?.name ?? "staff"}` })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** Entries of a bank account that a bank statement line has been matched to. */
async function seenInBank(ctx: Ctx, bankAccountId: string, isDefault: boolean) {
  const lines = await ctx.tx.bankLine.findMany({
    where: { status: "MATCHED", statement: isDefault ? { OR: [{ bankAccountId }, { bankAccountId: null }] } : { bankAccountId } },
    select: { entryId: true, matchRef: true },
  });
  const seen = new Set(lines.map((l) => l.entryId).filter((x): x is string => !!x));
  const refs = [...new Set(lines.map((l) => l.matchRef).filter((x): x is string => !!x))];
  if (refs.length) {
    const [sp, vs, ps, gs, ic] = await Promise.all([
      ctx.tx.supplierPayment.findMany({ where: { id: { in: refs } }, select: { entryId: true } }),
      ctx.tx.voucher.findMany({ where: { id: { in: refs } }, select: { entryId: true } }),
      ctx.tx.payment.findMany({ where: { id: { in: refs } }, select: { entryId: true } }),
      ctx.tx.gatewaySettlement.findMany({ where: { id: { in: refs } }, select: { entryId: true } }),
      ctx.tx.issuedCheque.findMany({ where: { id: { in: refs } }, select: { clearEntryId: true } }),
    ]);
    for (const r of [...sp, ...vs, ...ps, ...gs]) if (r.entryId) seen.add(r.entryId);
    for (const r of ic) if (r.clearEntryId) seen.add(r.clearEntryId);
  }
  return seen;
}

/**
 * The bank's own closing balance: the last statement day's line whose
 * balance no other line of that day runs on from (lines of one day carry no
 * order of their own, but their balances chain).
 */
async function statementClosing(ctx: Ctx, where: { statement: object }) {
  const latest = await ctx.tx.bankLine.findFirst({ where: { ...where, balance: { not: null } }, orderBy: { date: "desc" }, select: { date: true } });
  if (!latest) return null;
  const day = await ctx.tx.bankLine.findMany({ where: { ...where, balance: { not: null }, date: latest.date }, select: { balance: true, debit: true, credit: true }, orderBy: { createdAt: "desc" } });
  const before = new Set(day.map((l) => l.balance! - l.credit + l.debit));
  const end = day.find((l) => !before.has(l.balance!) || day.length === 1) ?? day[0];
  return { balance: end.balance, date: latest.date };
}

/**
 * The cash book or bank book of one account: opening, each day's money in
 * and out with its entries and closing balance, and the period's closing.
 * A bank book also marks each entry seen (or not yet) in a bank statement
 * and sets the statement's last balance beside the books'.
 */
export async function cashBook(ctx: Ctx, code: string, from: string, to: string) {
  const acc = await account(ctx, code);
  if (acc.kind !== "cash" && acc.kind !== "bank" && acc.kind !== "staff") throw new MoneyError("Pick a cash or bank account");
  const l = await accountLedger(ctx, acc.code, from, to);
  const bank = acc.kind === "bank" && acc.ref.bankAccountId ? await ctx.tx.bankAccount.findUnique({ where: { id: acc.ref.bankAccountId } }) : null;
  const seen = bank ? await seenInBank(ctx, bank.id, bank.isDefault) : null;
  const vouchers = await ctx.tx.voucher.findMany({ where: { entryId: { in: l.rows.map((r) => r.entryId) } }, select: { id: true, entryId: true } });
  const vHref = new Map(vouchers.map((v) => [v.entryId!, `/admin/books/vouchers/${v.id}`]));
  type Row = (typeof l.rows)[number] & { inBank: boolean | null };
  const days: { date: string; moneyIn: number; moneyOut: number; closing: number; rows: Row[] }[] = [];
  for (const r of l.rows) {
    let d = days[days.length - 1];
    if (!d || d.date !== r.date) days.push((d = { date: r.date, moneyIn: 0, moneyOut: 0, closing: 0, rows: [] }));
    d.moneyIn += r.debit;
    d.moneyOut += r.credit;
    d.closing = r.balance;
    d.rows.push({ ...r, href: vHref.get(r.entryId) ?? r.href, inBank: seen ? seen.has(r.entryId) : null });
  }
  let recon: null | { statementBalance: number | null; statementDate: string | null; unmatchedIn: number; unmatchedOut: number; unmatchedLines: number; notSeenIn: number; notSeenOut: number } = null;
  if (bank) {
    const where = { statement: bank.isDefault ? { OR: [{ bankAccountId: bank.id }, { bankAccountId: null }] } : { bankAccountId: bank.id } };
    const last = await statementClosing(ctx, where);
    const open = await ctx.tx.bankLine.aggregate({ where: { ...where, status: { in: ["UNMATCHED", "SUGGESTED"] } }, _sum: { credit: true, debit: true }, _count: true });
    const rows = days.flatMap((d) => d.rows);
    recon = {
      statementBalance: last?.balance ?? null,
      statementDate: last ? last.date.toISOString().slice(0, 10) : null,
      unmatchedIn: open._sum.credit ?? 0,
      unmatchedOut: open._sum.debit ?? 0,
      unmatchedLines: open._count,
      notSeenIn: rows.filter((r) => !r.inBank).reduce((a, r) => a + r.debit, 0),
      notSeenOut: rows.filter((r) => !r.inBank).reduce((a, r) => a + r.credit, 0),
    };
  }
  return { ...l, kind: acc.kind, days, recon };
}
