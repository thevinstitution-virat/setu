import type {
  AccountGroup,
  AccountType,
  BillKind,
  EntryKind,
  PayMethod,
  PayPurpose,
  PaymentMode,
} from "@/generated/prisma/client";
import { withTenantTx, type Tx } from "@/lib/db";
import { MoneyError } from "@/lib/money-error";
import { issueNoteDoc, issueSaleInvoice, type NoteInput } from "@/lib/invoice";
import { fyLabel, nextSequence } from "@/lib/orders";
import { formatINR } from "@/lib/money";
import { moneySettings, termsFor, type MoneySettings } from "@/lib/money-settings";
import { invoiceSettings } from "@/lib/invoice-settings";
import { queuedMessages } from "@/lib/notify";
import { kickMessages } from "@/lib/jobs";
import { paymentReceivedNotify } from "@/lib/notify-flows";
import { paymentWebhook } from "@/lib/webhooks";

/**
 * The money engine. Everything here runs inside withTenantTx(), so a money
 * event either fully happens (entry + bill/payment + allocations) or not at all.
 *
 * Sign convention: paise, debit positive, credit negative.
 *   RECEIVABLE balance > 0  → retailer owes us
 *   WALLET balance < 0      → we hold that much of the retailer's money
 *   STAFF_CASH balance > 0  → cash the staff member must hand over
 */

export type Ctx = { tx: Tx; tenantId: string; actorId: string | null };

/** Run a money operation atomically inside one tenant. */
export async function withMoney<T>(tenantId: string, actorId: string | null, fn: (ctx: Ctx) => Promise<T>) {
  let used: object | null = null;
  const out = await withTenantTx(
    tenantId,
    (tx) => {
      used = tx;
      return fn({ tx, tenantId, actorId });
    },
    { timeout: 20_000 }
  );
  // Messages queued in this transaction are now committed: send them soon.
  if (used && queuedMessages(used)) void kickMessages(tenantId);
  return out;
}

export { MoneyError };

// ───────────────────────────── accounts & entries ─────────────────────────────

/**
 * Which account. BANK with no bankAccountId is the business's default bank;
 * HEAD is one of the business's own heads (rent, salaries, capital …).
 */
export type AccountRef = { type: AccountType; retailerId?: string; userId?: string; headId?: string; bankAccountId?: string; supplierId?: string };

const PER_RETAILER: AccountType[] = ["RECEIVABLE", "WALLET", "WALLET_HOLD"];
/** One account per supplier: what we owe them, and what they owe us on claims. */
export const PER_SUPPLIER: AccountType[] = ["PAYABLE", "CLAIMS_RECEIVABLE"];

/** The account code, for every account whose code needs no lookup (not a chosen bank). */
export function accountCode(ref: AccountRef): string {
  if (PER_RETAILER.includes(ref.type)) {
    if (!ref.retailerId) throw new Error(`${ref.type} needs a retailerId`);
    return `${ref.type}:${ref.retailerId}`;
  }
  if (PER_SUPPLIER.includes(ref.type)) {
    if (!ref.supplierId) throw new Error(`${ref.type} needs a supplierId`);
    return `${ref.type}:${ref.supplierId}`;
  }
  if (ref.type === "STAFF_CASH") {
    if (!ref.userId) throw new Error("STAFF_CASH needs a userId");
    return `STAFF_CASH:${ref.userId}`;
  }
  if (ref.type === "HEAD") {
    if (!ref.headId) throw new Error("HEAD needs a headId");
    return `HEAD:${ref.headId}`;
  }
  if (ref.type === "BANK" && ref.bankAccountId) throw new Error("A chosen bank's code comes from its bank account");
  return ref.type;
}

/** Where each built-in account sits in the trial balance, P&L and balance sheet. */
export const GROUP_OF: Record<Exclude<AccountType, "HEAD">, AccountGroup> = {
  RECEIVABLE: "DEBTORS",
  WALLET: "CURRENT_LIABILITIES",
  WALLET_HOLD: "CURRENT_LIABILITIES",
  STAFF_CASH: "CASH",
  OFFICE_CASH: "CASH",
  BANK: "BANK",
  UPI_CLEARING: "IN_TRANSIT",
  CHEQUES_IN_HAND: "IN_TRANSIT",
  GATEWAY_CLEARING: "IN_TRANSIT",
  ISSUED_CHEQUES: "IN_TRANSIT",
  SALES: "SALES",
  GST_OUTPUT: "DUTIES_TAXES",
  GST_INPUT: "DUTIES_TAXES",
  TDS_PAYABLE: "DUTIES_TAXES",
  TDS_RECEIVABLE: "DUTIES_TAXES",
  OPENING_EQUITY: "CAPITAL",
  DISCOUNT: "INDIRECT_EXPENSES",
  CASH_SHORTAGE: "INDIRECT_EXPENSES",
  PROMOTIONS: "INDIRECT_EXPENSES",
  GATEWAY_FEES: "INDIRECT_EXPENSES",
  ROUND_OFF: "INDIRECT_EXPENSES",
  STOCK_LOSS: "INDIRECT_EXPENSES",
  PENALTY_INCOME: "OTHER_INCOME",
  CLAIM_INCOME: "OTHER_INCOME",
  PAYABLE: "CREDITORS",
  CLAIMS_RECEIVABLE: "CLAIMS",
  PURCHASES: "PURCHASES",
  PURCHASE_RETURNS: "PURCHASES",
};

export const NAMES: Record<AccountType, string> = {
  RECEIVABLE: "Receivable",
  WALLET: "Wallet",
  WALLET_HOLD: "Wallet (reserved)",
  STAFF_CASH: "Cash in hand",
  OFFICE_CASH: "Office cash",
  BANK: "Bank",
  UPI_CLEARING: "UPI received",
  CHEQUES_IN_HAND: "Cheques in hand",
  SALES: "Sales",
  GST_OUTPUT: "GST output",
  OPENING_EQUITY: "Opening balances",
  DISCOUNT: "Discounts and write-offs",
  PENALTY_INCOME: "Penalties",
  CASH_SHORTAGE: "Cash shortages",
  PROMOTIONS: "Promotions and rewards",
  GATEWAY_CLEARING: "Online payments to be settled",
  GATEWAY_FEES: "Payment gateway fees",
  PAYABLE: "Payable",
  PURCHASES: "Purchases",
  PURCHASE_RETURNS: "Purchase returns",
  GST_INPUT: "GST input credit",
  TDS_PAYABLE: "TDS payable",
  TDS_RECEIVABLE: "TDS deducted by customers",
  CLAIMS_RECEIVABLE: "Claims receivable",
  CLAIM_INCOME: "Claims on companies",
  ROUND_OFF: "Rounding off",
  STOCK_LOSS: "Stock shortage",
  ISSUED_CHEQUES: "Cheques issued, not cleared",
  HEAD: "Account head",
};

type Resolved = { code: string; name: string; group: AccountGroup; headId: string | null; bankAccountId: string | null };

/**
 * The code, name and group of an account. For posting (`posting`), a hidden
 * head or a closed bank is refused; for reading balances it is not.
 */
async function resolveAccount(ctx: Ctx, ref: AccountRef, posting: boolean): Promise<Resolved> {
  if (ref.type === "HEAD") {
    const h = ref.headId ? await ctx.tx.ledgerHead.findUnique({ where: { id: ref.headId } }) : null;
    if (!h) throw new MoneyError("Account head not found", 404);
    if (posting && !h.active) throw new MoneyError(`${h.name} is hidden. Show it again under Books → Accounts to post to it.`);
    return { code: `HEAD:${h.id}`, name: h.name, group: h.group, headId: h.id, bankAccountId: null };
  }
  if (ref.type === "BANK") {
    const b = ref.bankAccountId
      ? await ctx.tx.bankAccount.findUnique({ where: { id: ref.bankAccountId } })
      : await ctx.tx.bankAccount.findFirst({ where: { isDefault: true } });
    if (ref.bankAccountId && !b) throw new MoneyError("Bank account not found", 404);
    if (b) {
      if (posting && !b.active) throw new MoneyError(`${b.name} is closed. Open it again under Books → Bank accounts to post to it.`);
      return { code: b.ledgerCode, name: b.name, group: "BANK", headId: null, bankAccountId: b.id };
    }
    // No bank accounts set up yet: the business's one bank, as before.
    return { code: "BANK", name: NAMES.BANK, group: "BANK", headId: null, bankAccountId: null };
  }
  return { code: accountCode(ref), name: NAMES[ref.type], group: GROUP_OF[ref.type], headId: null, bankAccountId: null };
}

const refKey = (ref: AccountRef) =>
  ref.type === "HEAD" ? `HEAD:${ref.headId}` : ref.type === "BANK" ? `BANK#${ref.bankAccountId ?? "default"}` : accountCode(ref);

// Per-transaction cache: an account created in a transaction that rolls back
// must not be remembered, so the cache lives and dies with the tx object.
const accountCache = new WeakMap<object, Map<string, string>>();

export async function accountId(ctx: Ctx, ref: AccountRef): Promise<string> {
  const key = refKey(ref);
  let cache = accountCache.get(ctx.tx);
  if (!cache) accountCache.set(ctx.tx, (cache = new Map()));
  const hit = cache.get(key);
  if (hit) return hit;
  const r = await resolveAccount(ctx, ref, true);
  const acc = await ctx.tx.ledgerAccount.upsert({
    where: { tenantId_code: { tenantId: ctx.tenantId, code: r.code } },
    create: {
      tenantId: ctx.tenantId,
      type: ref.type,
      code: r.code,
      name: r.name,
      group: r.group,
      retailerId: ref.retailerId ?? null,
      userId: ref.userId ?? null,
      supplierId: ref.supplierId ?? null,
      headId: r.headId,
      bankAccountId: r.bankAccountId,
    },
    // The first bank account takes over the old "BANK" ledger account.
    update: r.bankAccountId ? { bankAccountId: r.bankAccountId, name: r.name } : {},
    select: { id: true },
  });
  cache.set(key, acc.id);
  return acc.id;
}

// ───────────────────────────── books lock ─────────────────────────────

const lockCache = new WeakMap<object, number | null>();
const dayOfDate = (d: Date) => Math.floor(d.getTime() / DAY_MS);
const ddmmyyyy = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10).split("-").reverse().join("/");

/** Refuses a posting dated on or before the day the books are closed up to. */
export async function assertBooksOpen(ctx: Ctx, when: Date) {
  let locked = lockCache.get(ctx.tx);
  if (locked === undefined) {
    const t = await ctx.tx.tenant.findUnique({ where: { id: ctx.tenantId }, select: { booksLockedUntil: true } });
    locked = t?.booksLockedUntil ? dayOfDate(t.booksLockedUntil) : null;
    lockCache.set(ctx.tx, locked);
  }
  if (locked !== null && istDay(when) <= locked) {
    throw new MoneyError(`The books are closed up to ${ddmmyyyy(locked)}. Ask the owner to open them to post on ${ddmmyyyy(istDay(when))}.`, 409);
  }
}

export type Line = { account: AccountRef; amount: number };

export async function post(
  ctx: Ctx,
  e: {
    kind: EntryKind;
    memo?: string;
    retailerId?: string | null;
    orderId?: string | null;
    paymentId?: string | null;
    supplierId?: string | null;
    occurredAt?: Date;
    lines: Line[];
  }
) {
  const lines = e.lines.filter((l) => l.amount !== 0);
  for (const l of lines) {
    if (!Number.isInteger(l.amount)) throw new Error("Ledger amounts must be whole paise");
  }
  const total = lines.reduce((s, l) => s + l.amount, 0);
  if (total !== 0) throw new Error(`Unbalanced entry (${total} paise)`);
  if (lines.length < 2) throw new Error("An entry needs at least two non-zero lines");
  await assertBooksOpen(ctx, e.occurredAt ?? new Date());

  const resolved = [];
  for (const l of lines) resolved.push({ accountId: await accountId(ctx, l.account), amount: l.amount });

  return ctx.tx.journalEntry.create({
    data: {
      kind: e.kind,
      memo: e.memo,
      retailerId: e.retailerId ?? null,
      orderId: e.orderId ?? null,
      paymentId: e.paymentId ?? null,
      supplierId: e.supplierId ?? null,
      occurredAt: e.occurredAt ?? new Date(),
      createdById: ctx.actorId,
      lines: { create: resolved },
    },
    select: { id: true },
  });
}

/** Cancel an entry with an equal and opposite one. Each entry can be reversed once. `at` dates the reversal (default now). */
export async function reverseEntry(ctx: Ctx, entryId: string, memo: string, at?: Date) {
  const orig = await ctx.tx.journalEntry.findUnique({
    where: { id: entryId },
    include: { lines: true, reversedBy: { select: { id: true } } },
  });
  if (!orig) throw new MoneyError("Entry not found", 404);
  if (orig.reversedBy) throw new MoneyError("This entry was already reversed", 409);
  await assertBooksOpen(ctx, at ?? new Date());
  return ctx.tx.journalEntry.create({
    data: {
      kind: "REVERSAL",
      memo,
      retailerId: orig.retailerId,
      orderId: orig.orderId,
      paymentId: orig.paymentId,
      supplierId: orig.supplierId,
      reversesId: orig.id,
      createdById: ctx.actorId,
      ...(at ? { occurredAt: at } : {}),
      lines: { create: orig.lines.map((l) => ({ accountId: l.accountId, amount: -l.amount })) },
    },
    select: { id: true },
  });
}

export async function balanceOf(ctx: Ctx, ref: AccountRef): Promise<number> {
  const code = ref.type === "HEAD" || ref.type === "BANK" ? (await resolveAccount(ctx, ref, false)).code : accountCode(ref);
  const acc = await ctx.tx.ledgerAccount.findUnique({
    where: { tenantId_code: { tenantId: ctx.tenantId, code } },
    select: { id: true },
  });
  if (!acc) return 0;
  const agg = await ctx.tx.ledgerLine.aggregate({ where: { accountId: acc.id }, _sum: { amount: true } });
  return Number(agg._sum.amount ?? 0);
}

export async function retailerBalances(ctx: Ctx, retailerId: string) {
  const [receivable, wallet, hold] = await Promise.all([
    balanceOf(ctx, { type: "RECEIVABLE", retailerId }),
    balanceOf(ctx, { type: "WALLET", retailerId }),
    balanceOf(ctx, { type: "WALLET_HOLD", retailerId }),
  ]);
  // 0 - x, not -x: an empty account must be 0, never -0.
  return { receivable, walletAvailable: 0 - wallet, walletReserved: 0 - hold };
}

/** Serialise money changes per retailer so allocations can't race. */
export async function lockRetailer(ctx: Ctx, retailerId: string) {
  await ctx.tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${ctx.tenantId}:${retailerId}`}))`;
}

// ───────────────────────────── dates (IST) ─────────────────────────────

const IST_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole IST day number, so "days old" doesn't flip at 5:30 am. */
export function istDay(d: Date) {
  return Math.floor((d.getTime() + IST_MS) / DAY_MS);
}

export function addDays(d: Date, days: number) {
  return new Date(d.getTime() + days * DAY_MS);
}

// ───────────────────────────── terms ─────────────────────────────

export async function loadTerms(ctx: Ctx, retailerId: string) {
  const [tenant, retailer] = await Promise.all([
    ctx.tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { settings: true } }),
    ctx.tx.retailerProfile.findUniqueOrThrow({
      where: { id: retailerId },
      select: { id: true, outletName: true, paymentMode: true, creditLimit: true, creditDays: true },
    }),
  ]);
  const settings = moneySettings(tenant.settings);
  return { settings, retailer, terms: termsFor(settings, retailer) };
}

// ───────────────────────────── bills & allocation ─────────────────────────────

async function nextNumber(ctx: Ctx, prefix: string) {
  const fy = fyLabel();
  const n = await nextSequence(ctx.tx, ctx.tenantId, `${prefix.toLowerCase()}:${fy}`);
  return `${prefix}-${fy}-${String(n).padStart(6, "0")}`;
}

async function createBill(
  ctx: Ctx,
  b: {
    retailerId: string;
    kind: BillKind;
    amount: number;
    number?: string;
    orderId?: string;
    date?: Date;
    creditDays: number;
    entryId: string;
    note?: string;
    salesmanId?: string | null;
    /** Imported bills: the old book's due date and what was already received on it. */
    dueDate?: Date;
    paid?: number;
  }
) {
  const date = b.date ?? new Date();
  const prefix = { ORDER: "BL", OPENING: "OB", PENALTY: "PN", DEBIT_NOTE: "DN" }[b.kind];
  return ctx.tx.bill.create({
    data: {
      retailerId: b.retailerId,
      kind: b.kind,
      number: b.number ?? (await nextNumber(ctx, prefix)),
      orderId: b.orderId ?? null,
      date,
      dueDate: b.dueDate ?? addDays(date, b.creditDays),
      amount: b.amount,
      paid: b.paid ?? 0,
      entryId: b.entryId,
      note: b.note,
      salesmanId: b.salesmanId ?? null,
    },
  });
}

/**
 * Match confirmed DUES payments' unallocated money to open bills, oldest
 * first. A payment collected against an order goes to that order's bill first.
 * Idempotent: run it after any bill or payment change.
 */
export async function allocateRetailer(ctx: Ctx, retailerId: string) {
  const bills = await ctx.tx.bill.findMany({
    where: { retailerId, settled: false },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });
  const payments = await ctx.tx.payment.findMany({
    where: { retailerId, purpose: "DUES", state: "CONFIRMED" },
    orderBy: [{ collectedAt: "asc" }, { createdAt: "asc" }],
  });
  const open = payments.filter((p) => p.allocated < p.amount);
  if (!bills.length || !open.length) return;

  const billLeft = new Map(bills.map((b) => [b.id, b.amount - b.paid]));
  for (const p of open) {
    let left = p.amount - p.allocated;
    const target = p.orderId ? bills.find((b) => b.orderId === p.orderId) : undefined;
    const order = target ? [target, ...bills.filter((b) => b !== target)] : bills;
    for (const b of order) {
      if (left <= 0) break;
      const room = billLeft.get(b.id)!;
      if (room <= 0) continue;
      const amt = Math.min(room, left);
      await ctx.tx.paymentAllocation.create({ data: { paymentId: p.id, billId: b.id, amount: amt } });
      billLeft.set(b.id, room - amt);
      left -= amt;
    }
    await ctx.tx.payment.update({ where: { id: p.id }, data: { allocated: p.amount - left } });
  }
  for (const b of bills) {
    const paid = b.amount - billLeft.get(b.id)!;
    if (paid !== b.paid) {
      await ctx.tx.bill.update({ where: { id: b.id }, data: { paid, settled: paid === b.amount } });
    }
  }
}

/** Undo a payment's allocations (for reversal / bounce) and re-run FIFO. */
async function deallocatePayment(ctx: Ctx, paymentId: string) {
  const allocs = await ctx.tx.paymentAllocation.findMany({ where: { paymentId } });
  for (const a of allocs) {
    const bill = await ctx.tx.bill.findUniqueOrThrow({ where: { id: a.billId } });
    await ctx.tx.bill.update({
      where: { id: a.billId },
      data: { paid: bill.paid - a.amount, settled: false },
    });
  }
  await ctx.tx.paymentAllocation.deleteMany({ where: { paymentId } });
  await ctx.tx.payment.update({ where: { id: paymentId }, data: { allocated: 0 } });
}

// ───────────────────────────── payments ─────────────────────────────

/** Where received money lands, by method. */
function debitAccountFor(method: PayMethod, retailerId: string, collector: { userId: string; office: boolean } | null): AccountRef {
  switch (method) {
    case "CASH":
      return collector && !collector.office ? { type: "STAFF_CASH", userId: collector.userId } : { type: "OFFICE_CASH" };
    case "UPI":
      return { type: "UPI_CLEARING" };
    case "BANK":
      return { type: "BANK" };
    case "CHEQUE":
      return { type: "CHEQUES_IN_HAND" };
    case "WALLET":
      return { type: "WALLET", retailerId };
    case "CREDIT_NOTE":
      return { type: "DISCOUNT" };
    case "ONLINE":
      // Held by the gateway until it settles to our bank (lib/gateway.ts).
      return { type: "GATEWAY_CLEARING" };
    case "TDS":
      // The shop paid this to the government for us (A9): we claim it against our income tax.
      return { type: "TDS_RECEIVABLE" };
  }
}

export type PaymentInput = {
  retailerId: string;
  amount: number;
  method: PayMethod;
  purpose?: PayPurpose;
  reference?: string | null;
  proofKey?: string | null;
  note?: string | null;
  orderId?: string | null;
  cheque?: { number: string; bank: string; date: Date } | null;
  /** Staff who physically took the money (cash goes to their cash-in-hand). */
  collectorId?: string | null;
  /** True when collected at the office (admin/accountant): cash goes to office cash. */
  atOffice?: boolean;
  /** Retailer-reported payments wait for staff verification before they count. */
  needsVerification?: boolean;
  /** Internal: settle from the wallet reservation made at order time. */
  fromHold?: boolean;
  occurredAt?: Date;
  /** Paid through the gateway: our request and the gateway's payment id (unique, so never posted twice). */
  gateway?: { intentId: string | null; paymentId: string } | null;
  /** Method TDS: the section the shop kept it back under. */
  tdsSection?: string | null;
};

export async function recordPayment(ctx: Ctx, p: PaymentInput) {
  const purpose = p.purpose ?? "DUES";
  if (!Number.isInteger(p.amount) || p.amount <= 0) throw new MoneyError("Amount must be more than ₹0");
  if (p.amount > 1_000_000_000) throw new MoneyError("Amount is too large");
  if (purpose === "WALLET" && (p.method === "WALLET" || p.method === "CREDIT_NOTE" || p.method === "TDS")) {
    throw new MoneyError("A wallet recharge must be cash, UPI, cheque or bank");
  }
  if (p.method === "TDS" && p.needsVerification) throw new MoneyError("TDS kept back by a shop is entered by the office");
  if (p.method === "CHEQUE" && (!p.cheque?.number || !p.cheque.bank)) {
    throw new MoneyError("Cheque number and bank are required");
  }
  await lockRetailer(ctx, p.retailerId);

  if (p.method === "WALLET" && !p.fromHold) {
    const { walletAvailable } = await retailerBalances(ctx, p.retailerId);
    if (walletAvailable < p.amount) {
      throw new MoneyError(`Wallet has only ${formatINR(walletAvailable)}`);
    }
  }

  const prefix = p.method === "CREDIT_NOTE" ? "CN" : p.method === "TDS" ? "TDS" : purpose === "WALLET" ? "RC" : "PAY";
  const payment = await ctx.tx.payment.create({
    data: {
      number: await nextNumber(ctx, prefix),
      retailerId: p.retailerId,
      purpose,
      method: p.method,
      state: p.needsVerification ? "PENDING_VERIFICATION" : "CONFIRMED",
      amount: p.amount,
      reference: p.reference || (p.method === "CHEQUE" ? p.cheque!.number : null),
      tdsSection: p.method === "TDS" ? (p.tdsSection ?? null) : null,
      proofKey: p.proofKey ?? null,
      note: p.note ?? null,
      orderId: p.orderId ?? null,
      collectedById: p.collectorId !== undefined ? p.collectorId : ctx.actorId,
      collectedAt: p.occurredAt ?? new Date(),
      ...(p.gateway ? { intentId: p.gateway.intentId, gatewayPaymentId: p.gateway.paymentId } : {}),
      ...(p.method === "CHEQUE"
        ? { cheque: { create: { number: p.cheque!.number, bank: p.cheque!.bank, chequeDate: p.cheque!.date } } }
        : {}),
    },
  }).catch((e: unknown) => {
    // Payment_reference_used_once: the same UTR is already waiting or counted
    // (the routes' own look-up lost a race with a second request). Prisma
    // doesn't name a partial index in the error, but for a UPI/bank payment
    // it's the only unique key left (numbers come from a locked counter;
    // gateway ids are for online payments).
    const refIndex = (p.method === "UPI" || p.method === "BANK") && !!p.reference && !p.gateway;
    if (refIndex && (e as { code?: string })?.code === "P2002") throw new MoneyError("This reference was already used", 409);
    throw e;
  });

  if (!p.needsVerification) await postPayment(ctx, payment.id, p);
  return ctx.tx.payment.findUniqueOrThrow({ where: { id: payment.id }, include: { cheque: true } });
}

async function postPayment(ctx: Ctx, paymentId: string, p: PaymentInput) {
  const purpose = p.purpose ?? "DUES";
  const collector = p.collectorId ?? ctx.actorId;
  const debit: AccountRef = p.fromHold
    ? { type: "WALLET_HOLD", retailerId: p.retailerId }
    : debitAccountFor(p.method, p.retailerId, collector ? { userId: collector, office: !!p.atOffice } : null);
  const credit: AccountRef =
    purpose === "WALLET" ? { type: "WALLET", retailerId: p.retailerId } : { type: "RECEIVABLE", retailerId: p.retailerId };
  const entry = await post(ctx, {
    kind: purpose === "WALLET" ? "WALLET_RECHARGE" : p.method === "CREDIT_NOTE" ? "CREDIT_NOTE" : p.fromHold ? "WALLET_SETTLE" : "PAYMENT",
    memo: p.note ?? undefined,
    retailerId: p.retailerId,
    orderId: p.orderId,
    paymentId,
    occurredAt: p.occurredAt,
    lines: [
      { account: debit, amount: p.amount },
      { account: credit, amount: -p.amount },
    ],
  });
  await ctx.tx.payment.update({ where: { id: paymentId }, data: { entryId: entry.id } });
  if (purpose === "DUES") await allocateRetailer(ctx, p.retailerId);
  // Receipt to the retailer (skips wallet settlements and TDS they kept back).
  if (!p.fromHold && p.method !== "TDS") {
    await paymentReceivedNotify(ctx.tx, ctx.tenantId, paymentId);
    await paymentWebhook(ctx.tx, ctx.tenantId, paymentId);
  }
}

/** Staff confirms a retailer-reported payment (e.g. UPI with UTR). */
export async function verifyPayment(ctx: Ctx, paymentId: string, approve: boolean, reason?: string) {
  const pay = await ctx.tx.payment.findUnique({ where: { id: paymentId } });
  if (!pay) throw new MoneyError("Payment not found", 404);
  if (pay.state !== "PENDING_VERIFICATION") throw new MoneyError("This payment is not waiting for verification", 409);
  await lockRetailer(ctx, pay.retailerId);
  if (!approve) {
    return ctx.tx.payment.update({
      where: { id: paymentId },
      data: { state: "REJECTED", rejectReason: reason || "Not received", verifiedById: ctx.actorId, verifiedAt: new Date() },
    });
  }
  await ctx.tx.payment.update({
    where: { id: paymentId },
    data: { state: "CONFIRMED", verifiedById: ctx.actorId, verifiedAt: new Date() },
  });
  await postPayment(ctx, paymentId, {
    retailerId: pay.retailerId,
    amount: pay.amount,
    method: pay.method,
    purpose: pay.purpose,
    note: pay.note,
    orderId: pay.orderId,
    collectorId: null,
    atOffice: true,
  });
  return ctx.tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
}

/** Cancel a confirmed payment entered by mistake. */
export async function reversePayment(ctx: Ctx, paymentId: string, reason: string) {
  const pay = await ctx.tx.payment.findUnique({ where: { id: paymentId }, include: { cheque: true } });
  if (!pay) throw new MoneyError("Payment not found", 404);
  if (pay.state !== "CONFIRMED" || !pay.entryId) throw new MoneyError("Only a confirmed payment can be reversed", 409);
  if (pay.cheque && pay.cheque.status !== "RECEIVED") throw new MoneyError("Use the cheque actions for a deposited cheque", 409);
  await lockRetailer(ctx, pay.retailerId);
  if (pay.purpose === "WALLET") {
    const { walletAvailable } = await retailerBalances(ctx, pay.retailerId);
    if (walletAvailable < pay.amount) throw new MoneyError("The recharged money has already been used", 409);
  }
  await reverseEntry(ctx, pay.entryId, `Payment ${pay.number} reversed: ${reason}`);
  await deallocatePayment(ctx, pay.id);
  await ctx.tx.payment.update({ where: { id: pay.id }, data: { state: "REVERSED", rejectReason: reason } });
  await allocateRetailer(ctx, pay.retailerId);
}

// ───────────────────────────── cheques ─────────────────────────────

export async function chequeAction(ctx: Ctx, chequeId: string, action: "deposit" | "clear" | "bounce", reason?: string) {
  const ch = await ctx.tx.cheque.findUnique({ where: { id: chequeId }, include: { payment: true } });
  if (!ch) throw new MoneyError("Cheque not found", 404);
  const pay = ch.payment;
  if (pay.state !== "CONFIRMED") throw new MoneyError("This cheque's payment is not active", 409);

  if (action === "deposit") {
    if (ch.status !== "RECEIVED") throw new MoneyError("Only a received cheque can be deposited", 409);
    return ctx.tx.cheque.update({ where: { id: ch.id }, data: { status: "DEPOSITED", depositedAt: new Date() } });
  }
  if (ch.status !== "DEPOSITED") throw new MoneyError("Deposit the cheque first", 409);
  await lockRetailer(ctx, pay.retailerId);

  if (action === "clear") {
    await post(ctx, {
      kind: "CHEQUE_CLEAR",
      memo: `Cheque ${ch.number} cleared`,
      retailerId: pay.retailerId,
      paymentId: pay.id,
      lines: [
        { account: { type: "BANK" }, amount: pay.amount },
        { account: { type: "CHEQUES_IN_HAND" }, amount: -pay.amount },
      ],
    });
    return ctx.tx.cheque.update({ where: { id: ch.id }, data: { status: "CLEARED", clearedAt: new Date() } });
  }

  // Bounce: the money never arrived. Undo the payment, then charge the penalty.
  const credit: AccountRef =
    pay.purpose === "WALLET" ? { type: "WALLET", retailerId: pay.retailerId } : { type: "RECEIVABLE", retailerId: pay.retailerId };
  await post(ctx, {
    kind: "CHEQUE_BOUNCE",
    memo: `Cheque ${ch.number} bounced${reason ? `: ${reason}` : ""}`,
    retailerId: pay.retailerId,
    paymentId: pay.id,
    lines: [
      { account: credit, amount: pay.amount },
      { account: { type: "CHEQUES_IN_HAND" }, amount: -pay.amount },
    ],
  });
  await deallocatePayment(ctx, pay.id);
  await ctx.tx.payment.update({ where: { id: pay.id }, data: { state: "REVERSED", rejectReason: "Cheque bounced" } });
  await ctx.tx.cheque.update({
    where: { id: ch.id },
    data: { status: "BOUNCED", bouncedAt: new Date(), bounceReason: reason ?? null },
  });

  const { settings } = await loadTerms(ctx, pay.retailerId);
  if (settings.chequeBouncePenalty > 0) {
    await chargeDebit(ctx, {
      retailerId: pay.retailerId,
      amount: settings.chequeBouncePenalty,
      kind: "PENALTY",
      note: `Cheque ${ch.number} bounce charge`,
    });
  }
  await allocateRetailer(ctx, pay.retailerId);
}

// ───────────────────────────── adjustments & opening ─────────────────────────────

/** Debit the retailer (penalty or debit note): creates a bill. */
export async function chargeDebit(
  ctx: Ctx,
  d: { retailerId: string; amount: number; kind: "PENALTY" | "DEBIT_NOTE"; note: string }
) {
  if (!Number.isInteger(d.amount) || d.amount <= 0) throw new MoneyError("Amount must be more than ₹0");
  await lockRetailer(ctx, d.retailerId);
  const { terms } = await loadTerms(ctx, d.retailerId);
  const entry = await post(ctx, {
    kind: d.kind === "PENALTY" ? "PENALTY" : "DEBIT_NOTE",
    memo: d.note,
    retailerId: d.retailerId,
    lines: [
      { account: { type: "RECEIVABLE", retailerId: d.retailerId }, amount: d.amount },
      { account: { type: d.kind === "PENALTY" ? "PENALTY_INCOME" : "SALES" }, amount: -d.amount },
    ],
  });
  const bill = await createBill(ctx, {
    retailerId: d.retailerId,
    kind: d.kind,
    amount: d.amount,
    creditDays: terms.creditDays,
    entryId: entry.id,
    note: d.note,
  });
  await allocateRetailer(ctx, d.retailerId);
  return bill;
}

/**
 * Opening balance when moving a retailer onto VBiz Pro. Positive = they owe us
 * (an opening bill dated asOf); negative = advance we hold (a credit that
 * pays future bills).
 */
export async function openingBalance(ctx: Ctx, retailerId: string, amount: number, asOf: Date, note = "Opening balance") {
  if (!Number.isInteger(amount) || amount === 0) throw new MoneyError("Opening balance must be a non-zero amount");
  await lockRetailer(ctx, retailerId);
  const existing = await ctx.tx.journalEntry.count({ where: { retailerId, kind: "OPENING", reversedBy: null } });
  if (existing) throw new MoneyError("This retailer already has an opening balance", 409);
  const { terms } = await loadTerms(ctx, retailerId);

  const entry = await post(ctx, {
    kind: "OPENING",
    memo: note,
    retailerId,
    occurredAt: asOf,
    lines: [
      { account: { type: "RECEIVABLE", retailerId }, amount },
      { account: { type: "OPENING_EQUITY" }, amount: -amount },
    ],
  });
  if (amount > 0) {
    await createBill(ctx, { retailerId, kind: "OPENING", amount, date: asOf, creditDays: terms.creditDays, entryId: entry.id, note });
  } else {
    // An advance is modelled as a confirmed credit that allocation can use.
    await ctx.tx.payment.create({
      data: {
        number: await nextNumber(ctx, "CN"),
        retailerId,
        method: "CREDIT_NOTE",
        state: "CONFIRMED",
        amount: -amount,
        note: `${note} (advance)`,
        collectedById: ctx.actorId,
        collectedAt: asOf,
        entryId: entry.id,
      },
    });
  }
  await allocateRetailer(ctx, retailerId);
}

export type OpeningBill = {
  /** The old book's invoice number, kept as the bill number (A004081). */
  number: string;
  date: Date;
  /** null = date + the shop's credit days. */
  dueDate: Date | null;
  /** Bill value and what was already received on it in the old book, paise. */
  amount: number;
  paid: number;
  salesmanId: string | null;
};

/**
 * Opening balance bill by bill, when moving a shop from another book: each
 * open bill keeps its number, date, due date, value and part payment, so
 * ageing, days overdue and the outstanding reports are right from day one.
 * `advance` (paise) = money the shop paid that no bill has used yet.
 * Same rule as openingBalance: once per shop, refused rows write nothing.
 */
export async function openingBills(ctx: Ctx, retailerId: string, bills: OpeningBill[], advance = 0, asOf = new Date()) {
  if (!bills.length && advance <= 0) throw new MoneyError("Nothing to import for this shop");
  if (!Number.isInteger(advance) || advance < 0) throw new MoneyError("Advance must be whole paise, 0 or more");
  const numbers = new Set<string>();
  for (const b of bills) {
    if (!b.number.trim()) throw new MoneyError("Every bill needs its number");
    if (numbers.has(b.number)) throw new MoneyError(`Bill ${b.number} is repeated`);
    numbers.add(b.number);
    if (!Number.isInteger(b.amount) || b.amount <= 0) throw new MoneyError(`Bill ${b.number}: value must be more than ₹0`);
    if (!Number.isInteger(b.paid) || b.paid < 0 || b.paid >= b.amount) throw new MoneyError(`Bill ${b.number}: received must be less than the bill value`);
    if (b.dueDate && b.dueDate < b.date) throw new MoneyError(`Bill ${b.number}: due date is before the bill date`);
  }
  await lockRetailer(ctx, retailerId);
  const existing = await ctx.tx.journalEntry.count({ where: { retailerId, kind: "OPENING", reversedBy: null } });
  if (existing) throw new MoneyError("This shop already has an opening balance", 409);
  if (numbers.size) {
    const taken = await ctx.tx.bill.findFirst({ where: { number: { in: [...numbers] } }, select: { number: true } });
    if (taken) throw new MoneyError(`Bill number ${taken.number} is already in VBiz Pro`, 409);
  }
  const { terms } = await loadTerms(ctx, retailerId);

  const dues = bills.reduce((a, b) => a + b.amount - b.paid, 0);
  if (dues > 0) {
    const entry = await post(ctx, {
      kind: "OPENING",
      memo: `Opening balance: ${bills.length} bill${bills.length === 1 ? "" : "s"} from the old book`,
      retailerId,
      occurredAt: asOf,
      lines: [
        { account: { type: "RECEIVABLE", retailerId }, amount: dues },
        { account: { type: "OPENING_EQUITY" }, amount: -dues },
      ],
    });
    for (const b of [...bills].sort((x, y) => x.date.getTime() - y.date.getTime())) {
      await createBill(ctx, {
        retailerId,
        kind: "OPENING",
        number: b.number,
        date: b.date,
        dueDate: b.dueDate ?? undefined,
        creditDays: terms.creditDays,
        amount: b.amount,
        paid: b.paid,
        entryId: entry.id,
        note: b.paid ? `Opening bill (₹${(b.paid / 100).toFixed(2)} received in the old book)` : "Opening bill",
        salesmanId: b.salesmanId,
      });
    }
  }
  if (advance > 0) {
    const entry = await post(ctx, {
      kind: "OPENING",
      memo: "Opening advance from the old book",
      retailerId,
      occurredAt: asOf,
      lines: [
        { account: { type: "RECEIVABLE", retailerId }, amount: -advance },
        { account: { type: "OPENING_EQUITY" }, amount: advance },
      ],
    });
    await ctx.tx.payment.create({
      data: {
        number: await nextNumber(ctx, "CN"),
        retailerId,
        method: "CREDIT_NOTE",
        state: "CONFIRMED",
        amount: advance,
        note: "Opening advance (old book)",
        collectedById: ctx.actorId,
        collectedAt: asOf,
        entryId: entry.id,
      },
    });
  }
  await allocateRetailer(ctx, retailerId);
  return { bills: bills.length, dues, advance };
}

// ───────────────────────────── orders ─────────────────────────────

/**
 * Called inside the order-creation transaction. Prepaid: reserve the order
 * total from the wallet (refuse if short). Postpaid: put the order on credit
 * hold when it would cross the limit or the retailer has overdue bills.
 */
export async function onOrderPlaced(ctx: Ctx, order: { id: string; retailerId: string; totalAmount: number; orderNumber: string }) {
  await lockRetailer(ctx, order.retailerId);
  const { settings, terms } = await loadTerms(ctx, order.retailerId);

  if (terms.mode === "PREPAID") {
    const { walletAvailable } = await retailerBalances(ctx, order.retailerId);
    if (walletAvailable < order.totalAmount) {
      throw new MoneyError(
        `Wallet balance ${formatINR(walletAvailable)} is less than the order total ${formatINR(order.totalAmount)}. Please recharge first.`,
        402
      );
    }
    await post(ctx, {
      kind: "WALLET_HOLD",
      memo: `Reserved for ${order.orderNumber}`,
      retailerId: order.retailerId,
      orderId: order.id,
      lines: [
        { account: { type: "WALLET", retailerId: order.retailerId }, amount: order.totalAmount },
        { account: { type: "WALLET_HOLD", retailerId: order.retailerId }, amount: -order.totalAmount },
      ],
    });
    await ctx.tx.order.update({ where: { id: order.id }, data: { walletHold: order.totalAmount } });
    return { hold: false as const, reason: null };
  }

  const reason = await creditHoldReason(ctx, settings, terms, order);
  if (reason) {
    await ctx.tx.order.update({ where: { id: order.id }, data: { creditHold: true, creditHoldReason: reason } });
  }
  return { hold: !!reason, reason };
}

async function creditHoldReason(
  ctx: Ctx,
  settings: MoneySettings,
  terms: { mode: PaymentMode; creditLimit: number | null; creditDays: number },
  order: { id: string; retailerId: string; totalAmount: number }
): Promise<string | null> {
  if (settings.holdOnOverdue) {
    const cutoff = addDays(new Date(), -settings.overdueGraceDays);
    const overdue = await ctx.tx.bill.findFirst({
      where: { retailerId: order.retailerId, settled: false, dueDate: { lt: cutoff } },
      orderBy: { dueDate: "asc" },
    });
    if (overdue) {
      return `Overdue bill ${overdue.number} (${formatINR(overdue.amount - overdue.paid)} due ${overdue.dueDate.toISOString().slice(0, 10)})`;
    }
  }
  if (terms.creditLimit !== null) {
    const { receivable } = await retailerBalances(ctx, order.retailerId);
    const open = await ctx.tx.order.aggregate({
      where: {
        retailerId: order.retailerId,
        id: { not: order.id },
        status: { notIn: ["DELIVERED", "CANCELLED"] },
        // Invoiced at dispatch → already in the receivable; don't count it twice.
        invoices: { none: { type: { in: ["TAX_INVOICE", "BILL_OF_SUPPLY"] } } },
      },
      _sum: { totalAmount: true },
    });
    const exposure = receivable + Number(open._sum.totalAmount ?? 0) + order.totalAmount;
    if (exposure > terms.creditLimit) {
      return `Over credit limit by ${formatINR(exposure - terms.creditLimit)} (limit ${formatINR(terms.creditLimit)})`;
    }
  }
  return null;
}

/** Order cancelled before delivery: give back any wallet reservation. */
export async function onOrderCancelled(ctx: Ctx, order: { id: string; retailerId: string; walletHold: number; orderNumber: string }) {
  if (order.walletHold <= 0) return;
  await lockRetailer(ctx, order.retailerId);
  await post(ctx, {
    kind: "WALLET_RELEASE",
    memo: `Released: ${order.orderNumber} cancelled`,
    retailerId: order.retailerId,
    orderId: order.id,
    lines: [
      { account: { type: "WALLET_HOLD", retailerId: order.retailerId }, amount: order.walletHold },
      { account: { type: "WALLET", retailerId: order.retailerId }, amount: -order.walletHold },
    ],
  });
  await ctx.tx.order.update({ where: { id: order.id }, data: { walletHold: 0 } });
}

/**
 * Order delivered: book the sale and its bill, settle prepaid orders from the
 * wallet reservation, and record anything collected on the spot.
 */
export async function onOrderDelivered(
  ctx: Ctx,
  order: {
    id: string;
    retailerId: string;
    orderNumber: string;
    subtotal: number;
    gstAmount: number;
    totalAmount: number;
    walletHold: number;
  },
  collect: Omit<PaymentInput, "retailerId" | "orderId" | "purpose"> | null
) {
  await lockRetailer(ctx, order.retailerId);
  // Already invoiced at dispatch → nothing to book; otherwise invoice now.
  const { invoice } = await bookSale(ctx, order.id);

  if (order.walletHold > 0) {
    const use = Math.min(order.walletHold, order.totalAmount);
    await recordPayment(ctx, {
      retailerId: order.retailerId,
      amount: use,
      method: "WALLET",
      fromHold: true,
      orderId: order.id,
      note: `Paid from wallet for ${order.orderNumber}`,
    });
    const leftover = order.walletHold - use;
    if (leftover > 0) {
      await onOrderCancelled(ctx, { ...order, walletHold: leftover });
    }
    await ctx.tx.order.update({ where: { id: order.id }, data: { walletHold: 0 } });
  }

  let payment = null;
  if (collect && collect.amount > 0) {
    payment = await recordPayment(ctx, { ...collect, retailerId: order.retailerId, orderId: order.id, purpose: "DUES" });
  }
  await allocateRetailer(ctx, order.retailerId);
  return { payment, invoice };
}

// ───────────────────────────── invoices (Phase 3) ─────────────────────────────

/**
 * Issue the order's GST invoice and book the sale against it: Receivable
 * (total) = Sales (taxable) + GST output (tax), and a bill numbered as the
 * invoice. Runs at dispatch or at delivery (settings.invoice.issueAt).
 * Idempotent: an order that is already billed is left alone.
 */
export async function bookSale(ctx: Ctx, orderId: string, now = new Date()) {
  const order = await ctx.tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { id: true, retailerId: true, orderNumber: true, salesmanId: true } });
  await lockRetailer(ctx, order.retailerId);
  const billed = await ctx.tx.bill.findUnique({ where: { orderId } });
  if (billed) {
    const invoice = await ctx.tx.invoice.findFirst({ where: { orderId, type: { in: ["TAX_INVOICE", "BILL_OF_SUPPLY"] } } });
    return { invoice, booked: false };
  }
  const { invoice } = await issueSaleInvoice(ctx, orderId, now);
  const { terms } = await loadTerms(ctx, order.retailerId);
  const sale = await post(ctx, {
    kind: "SALE",
    memo: `Invoice ${invoice.number} (order ${order.orderNumber})`,
    retailerId: order.retailerId,
    orderId,
    occurredAt: now,
    lines: [
      { account: { type: "RECEIVABLE", retailerId: order.retailerId }, amount: invoice.total },
      { account: { type: "SALES" }, amount: -invoice.taxable },
      { account: { type: "GST_OUTPUT" }, amount: -(invoice.cgst + invoice.sgst + invoice.igst) },
    ],
  });
  await createBill(ctx, {
    retailerId: order.retailerId,
    kind: "ORDER",
    number: invoice.number,
    orderId,
    date: now,
    amount: invoice.total,
    creditDays: terms.mode === "PREPAID" ? 0 : terms.creditDays,
    entryId: sale.id,
    salesmanId: order.salesmanId,
  });
  const linked = await ctx.tx.invoice.update({ where: { id: invoice.id }, data: { entryId: sale.id } });
  return { invoice: linked, booked: true };
}

/**
 * Credit note: reverses sales and GST for returned goods, a lower rate, or a
 * cancelled order. The retailer's receivable goes down through a confirmed
 * CREDIT_NOTE credit that pays the invoice's bill first, then older bills.
 */
export async function issueCreditNote(ctx: Ctx, input: Omit<NoteInput, "type">, now = new Date()) {
  const inv = await ctx.tx.invoice.findUnique({ where: { id: input.invoiceId }, select: { retailerId: true } });
  if (!inv) throw new MoneyError("Invoice not found", 404);
  await lockRetailer(ctx, inv.retailerId);
  const { note, original } = await issueNoteDoc(ctx, { ...input, type: "CREDIT_NOTE" }, now);
  const entry = await post(ctx, {
    kind: "CREDIT_NOTE",
    memo: `Credit note ${note.number} on ${original.number}: ${note.reason}`,
    retailerId: note.retailerId,
    orderId: note.orderId ?? undefined,
    occurredAt: now,
    lines: [
      { account: { type: "SALES" }, amount: note.taxable },
      { account: { type: "GST_OUTPUT" }, amount: note.cgst + note.sgst + note.igst },
      { account: { type: "RECEIVABLE", retailerId: note.retailerId }, amount: -note.total },
    ],
  });
  await ctx.tx.payment.create({
    data: {
      number: note.number,
      retailerId: note.retailerId,
      method: "CREDIT_NOTE",
      state: "CONFIRMED",
      amount: note.total,
      note: `Credit note on ${original.number}: ${note.reason}`,
      orderId: note.orderId,
      collectedById: ctx.actorId,
      collectedAt: now,
      verifiedById: ctx.actorId,
      verifiedAt: now,
      entryId: entry.id,
    },
  });
  const linked = await ctx.tx.invoice.update({ where: { id: note.id }, data: { entryId: entry.id } });
  await allocateRetailer(ctx, note.retailerId);
  return linked;
}

/** Debit note: more sales and GST on an invoice (rate raised, short-billed); creates a bill. */
export async function issueDebitNote(ctx: Ctx, input: Omit<NoteInput, "type" | "kind">, now = new Date()) {
  const inv = await ctx.tx.invoice.findUnique({ where: { id: input.invoiceId }, select: { retailerId: true } });
  if (!inv) throw new MoneyError("Invoice not found", 404);
  await lockRetailer(ctx, inv.retailerId);
  const { note, original } = await issueNoteDoc(ctx, { ...input, type: "DEBIT_NOTE", kind: "value" }, now);
  const { terms } = await loadTerms(ctx, note.retailerId);
  const entry = await post(ctx, {
    kind: "DEBIT_NOTE",
    memo: `Debit note ${note.number} on ${original.number}: ${note.reason}`,
    retailerId: note.retailerId,
    orderId: note.orderId ?? undefined,
    occurredAt: now,
    lines: [
      { account: { type: "RECEIVABLE", retailerId: note.retailerId }, amount: note.total },
      { account: { type: "SALES" }, amount: -note.taxable },
      { account: { type: "GST_OUTPUT" }, amount: -(note.cgst + note.sgst + note.igst) },
    ],
  });
  await createBill(ctx, {
    retailerId: note.retailerId,
    kind: "DEBIT_NOTE",
    number: note.number,
    date: now,
    amount: note.total,
    creditDays: terms.mode === "PREPAID" ? 0 : terms.creditDays,
    entryId: entry.id,
    note: `Debit note on ${original.number}: ${note.reason}`,
  });
  const linked = await ctx.tx.invoice.update({ where: { id: note.id }, data: { entryId: entry.id } });
  await allocateRetailer(ctx, note.retailerId);
  return linked;
}

/** Order leaves for delivery: invoice it now when the tenant issues invoices at dispatch. */
export async function onOrderDispatched(ctx: Ctx, orderId: string) {
  const t = await ctx.tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { settings: true } });
  if (invoiceSettings(t.settings).issueAt !== "dispatch") return null;
  return (await bookSale(ctx, orderId)).invoice;
}

/** An invoiced (dispatched) order is cancelled: credit everything left on its invoice. */
export async function creditCancelledOrder(ctx: Ctx, orderId: string, reason: string) {
  const inv = await ctx.tx.invoice.findFirst({ where: { orderId, type: { in: ["TAX_INVOICE", "BILL_OF_SUPPLY"] } } });
  if (!inv) return null;
  return issueCreditNote(ctx, { invoiceId: inv.id, kind: "cancel", reason, lines: [] });
}

// ───────────────────────────── staff cash ─────────────────────────────

export async function cashInHand(ctx: Ctx, userId: string) {
  return balanceOf(ctx, { type: "STAFF_CASH", userId });
}

/** Office receives cash from a staff member. Any difference stays on their cash-in-hand. */
export async function recordHandover(ctx: Ctx, h: { staffUserId: string; counted: number; note?: string }) {
  if (!Number.isInteger(h.counted) || h.counted < 0) throw new MoneyError("Counted amount must be ₹0 or more");
  await ctx.tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${ctx.tenantId}:cash:${h.staffUserId}`}))`;
  const expected = await cashInHand(ctx, h.staffUserId);
  if (h.counted > expected) {
    throw new MoneyError(`Counted ${formatINR(h.counted)} is more than the ${formatINR(expected)} this person holds`);
  }
  let entryId: string | null = null;
  if (h.counted > 0) {
    const e = await post(ctx, {
      kind: "HANDOVER",
      memo: h.note ?? "Cash handover",
      lines: [
        { account: { type: "OFFICE_CASH" }, amount: h.counted },
        { account: { type: "STAFF_CASH", userId: h.staffUserId }, amount: -h.counted },
      ],
    });
    entryId = e.id;
  }
  return ctx.tx.cashHandover.create({
    data: {
      staffUserId: h.staffUserId,
      receivedById: ctx.actorId ?? "system",
      expected,
      counted: h.counted,
      variance: expected - h.counted,
      note: h.note ?? null,
      entryId,
    },
  });
}

/** Accept a shortage as a loss (removes it from the staff member's cash-in-hand). */
export async function writeOffShortage(ctx: Ctx, staffUserId: string, amount: number, note: string) {
  if (!Number.isInteger(amount) || amount <= 0) throw new MoneyError("Amount must be more than ₹0");
  // Same lock as a handover: two write-offs at once can't exceed what is held.
  await ctx.tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${ctx.tenantId}:cash:${staffUserId}`}))`;
  const held = await cashInHand(ctx, staffUserId);
  if (amount > held) throw new MoneyError(`Only ${formatINR(held)} is outstanding for this person`);
  return post(ctx, {
    kind: "SHORTAGE_WRITEOFF",
    memo: note,
    lines: [
      { account: { type: "CASH_SHORTAGE" }, amount },
      { account: { type: "STAFF_CASH", userId: staffUserId }, amount: -amount },
    ],
  });
}

// ───────────────────────────── reporting ─────────────────────────────

export const AGE_BUCKETS = [
  { key: "d0_7", label: "0–7 days", max: 7 },
  { key: "d8_15", label: "8–15 days", max: 15 },
  { key: "d16_30", label: "16–30 days", max: 30 },
  { key: "d30p", label: "30+ days", max: Infinity },
] as const;

export type Ageing = Record<(typeof AGE_BUCKETS)[number]["key"], number>;

export function ageBills(bills: { date: Date; amount: number; paid: number }[], today = new Date()): Ageing {
  const out: Ageing = { d0_7: 0, d8_15: 0, d16_30: 0, d30p: 0 };
  const t = istDay(today);
  for (const b of bills) {
    const left = b.amount - b.paid;
    if (left <= 0) continue;
    const age = t - istDay(b.date);
    out[AGE_BUCKETS.find((x) => age <= x.max)!.key] += left;
  }
  return out;
}

/** Statement of the receivable account with a running balance. */
export async function statement(ctx: Ctx, retailerId: string, from: Date, to: Date) {
  const acc = await ctx.tx.ledgerAccount.findUnique({
    where: { tenantId_code: { tenantId: ctx.tenantId, code: accountCode({ type: "RECEIVABLE", retailerId }) } },
  });
  if (!acc) return { opening: 0, closing: 0, rows: [] };
  const before = await ctx.tx.ledgerLine.aggregate({
    where: { accountId: acc.id, entry: { occurredAt: { lt: from } } },
    _sum: { amount: true },
  });
  const lines = await ctx.tx.ledgerLine.findMany({
    where: { accountId: acc.id, entry: { occurredAt: { gte: from, lte: to } } },
    include: { entry: { select: { kind: true, memo: true, occurredAt: true, orderId: true, paymentId: true } } },
    orderBy: [{ entry: { occurredAt: "asc" } }, { createdAt: "asc" }],
  });
  let running = Number(before._sum.amount ?? 0);
  const opening = running;
  const rows = lines.map((l) => {
    running += l.amount;
    return {
      date: l.entry.occurredAt,
      kind: l.entry.kind,
      memo: l.entry.memo,
      debit: l.amount > 0 ? l.amount : 0,
      credit: l.amount < 0 ? -l.amount : 0,
      balance: running,
    };
  });
  return { opening, closing: running, rows };
}
