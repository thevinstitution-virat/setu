import type { AccountGroup, AccountType, BankKind, EntryKind } from "@/generated/prisma/client";
import { GROUP_OF, MoneyError, NAMES, type Ctx } from "@/lib/ledger";
import { istDay as istDayText } from "@/lib/field-math";

/**
 * The books: chart of accounts, account heads, bank accounts, the books lock,
 * any account's ledger, the day book and the books check. Everything reads
 * the one ledger (lib/ledger.ts); nothing here posts money.
 */

// ───────────────────────────── groups ─────────────────────────────

export type Side = "asset" | "liability" | "capital" | "income" | "expense";

/** Where each group sits, in the order the chart of accounts lists them. */
export const GROUPS: Record<AccountGroup, { label: string; side: Side }> = {
  CAPITAL: { label: "Capital", side: "capital" },
  DRAWINGS: { label: "Drawings", side: "capital" },
  LOANS: { label: "Loans taken", side: "liability" },
  CREDITORS: { label: "Suppliers (creditors)", side: "liability" },
  CURRENT_LIABILITIES: { label: "Other liabilities", side: "liability" },
  DUTIES_TAXES: { label: "Duties and taxes", side: "liability" },
  FIXED_ASSETS: { label: "Fixed assets", side: "asset" },
  DEBTORS: { label: "Shops (debtors)", side: "asset" },
  CLAIMS: { label: "Claims on companies", side: "asset" },
  CASH: { label: "Cash", side: "asset" },
  BANK: { label: "Bank accounts", side: "asset" },
  IN_TRANSIT: { label: "Money on the way", side: "asset" },
  CURRENT_ASSETS: { label: "Other assets", side: "asset" },
  SALES: { label: "Sales", side: "income" },
  OTHER_INCOME: { label: "Other income", side: "income" },
  PURCHASES: { label: "Purchases", side: "expense" },
  DIRECT_EXPENSES: { label: "Direct expenses", side: "expense" },
  INDIRECT_EXPENSES: { label: "Office and running expenses", side: "expense" },
};
export const GROUP_ORDER = Object.keys(GROUPS) as AccountGroup[];

/** Groups a business's own head may go in (the rest belong to built-in accounts). */
export const HEAD_GROUPS: AccountGroup[] = [
  "INDIRECT_EXPENSES",
  "DIRECT_EXPENSES",
  "OTHER_INCOME",
  "FIXED_ASSETS",
  "CURRENT_ASSETS",
  "CASH",
  "LOANS",
  "CURRENT_LIABILITIES",
  "CAPITAL",
  "DRAWINGS",
];

/** Heads every business gets on first opening the books (renamable, hideable). */
export const STARTER_HEADS: { key: string; name: string; group: AccountGroup }[] = [
  { key: "rent", name: "Rent", group: "INDIRECT_EXPENSES" },
  { key: "salaries", name: "Salaries and wages", group: "INDIRECT_EXPENSES" },
  { key: "fuel", name: "Fuel and conveyance", group: "INDIRECT_EXPENSES" },
  { key: "vehicle_repairs", name: "Vehicle repairs", group: "INDIRECT_EXPENSES" },
  { key: "electricity", name: "Electricity", group: "INDIRECT_EXPENSES" },
  { key: "phone", name: "Phone and internet", group: "INDIRECT_EXPENSES" },
  { key: "office", name: "Office expenses", group: "INDIRECT_EXPENSES" },
  { key: "bank_charges", name: "Bank charges", group: "INDIRECT_EXPENSES" },
  { key: "interest_paid", name: "Interest paid", group: "INDIRECT_EXPENSES" },
  { key: "freight_in", name: "Freight inward", group: "DIRECT_EXPENSES" },
  { key: "loading", name: "Loading and unloading", group: "DIRECT_EXPENSES" },
  { key: "interest_received", name: "Interest received", group: "OTHER_INCOME" },
  { key: "capital", name: "Owner's capital", group: "CAPITAL" },
  { key: "drawings", name: "Owner's drawings", group: "DRAWINGS" },
  { key: "furniture", name: "Furniture and fittings", group: "FIXED_ASSETS" },
  { key: "vehicles", name: "Vehicles", group: "FIXED_ASSETS" },
  { key: "computers", name: "Computers and phones", group: "FIXED_ASSETS" },
  { key: "petty_cash", name: "Petty cash", group: "CASH" },
];

export const KIND_LABEL: Record<EntryKind, string> = {
  SALE: "Sales invoice",
  OPENING: "Opening balance",
  PAYMENT: "Receipt",
  WALLET_RECHARGE: "Wallet recharge",
  WALLET_HOLD: "Wallet reserved",
  WALLET_RELEASE: "Wallet released",
  WALLET_SETTLE: "Paid from wallet",
  CHEQUE_CLEAR: "Cheque cleared",
  CHEQUE_BOUNCE: "Cheque bounced",
  PENALTY: "Penalty",
  DEBIT_NOTE: "Debit note",
  CREDIT_NOTE: "Credit note",
  HANDOVER: "Cash handover",
  SHORTAGE_WRITEOFF: "Shortage written off",
  REVERSAL: "Reversal",
  REWARD: "Reward",
  BANK_MATCH: "Seen in the bank",
  GATEWAY_SETTLEMENT: "Gateway settlement",
  PURCHASE: "Purchase bill",
  PURCHASE_DEBIT_NOTE: "Debit note to supplier",
  PURCHASE_CREDIT_NOTE: "Credit note from supplier",
  SUPPLIER_PAYMENT: "Payment to supplier",
  ISSUED_CHEQUE_CLEAR: "Our cheque cleared",
  CLAIM_RAISE: "Claim on a company",
  CLAIM_RECEIPT: "Claim money received",
  CLAIM_WRITE_OFF: "Claim written off",
  VOUCHER_PAYMENT: "Payment voucher",
  VOUCHER_RECEIPT: "Receipt voucher",
  CONTRA: "Contra",
  JOURNAL: "Journal voucher",
  STOCK_COUNT: "Stock count",
};

export const BANK_KINDS: Record<BankKind, string> = { CURRENT: "Current account", SAVINGS: "Savings account", OD: "Overdraft (OD)", CC: "Cash credit (CC)" };

// ───────────────────────────── dates (IST days, "YYYY-MM-DD") ─────────────────────────────

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const todayIst = () => istDayText();
export function isDay(s: unknown): s is string {
  return typeof s === "string" && DAY_RE.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
}
export const dayStart = (d: string) => new Date(`${d}T00:00:00+05:30`);
export const dayEnd = (d: string) => new Date(`${d}T23:59:59.999+05:30`);
/** 1 April of the financial year a day is in. */
export function fyStart(day = todayIst()) {
  const y = Number(day.slice(0, 4));
  return Number(day.slice(5, 7)) >= 4 ? `${y}-04-01` : `${y - 1}-04-01`;
}
export const fyName = (day = todayIst()) => {
  const y = Number(fyStart(day).slice(0, 4));
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
};
export const showDay = (d: string) => d.split("-").reverse().join("/");

/** A from/to period from a query: defaults to this financial year so far, at most 400 days. */
export function readPeriod(sp: URLSearchParams, fallback: "fy" | "today" = "fy"): { from: string; to: string } | { error: string } {
  const today = todayIst();
  const from = sp.get("from") || (fallback === "fy" ? fyStart(today) : today);
  const to = sp.get("to") || today;
  if (!isDay(from) || !isDay(to)) return { error: "Dates must be YYYY-MM-DD" };
  if (to < from) return { error: "The end date is before the start date" };
  if (dayStart(to).getTime() - dayStart(from).getTime() > 400 * 86_400_000) return { error: "Pick at most 400 days" };
  return { from, to };
}

// ───────────────────────────── set-up ─────────────────────────────

const lockBooks = (ctx: Ctx) => ctx.tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${ctx.tenantId}:books`}))`;

/**
 * First opening of the books: the starter heads and the "Main bank" (which
 * takes over the old single "BANK" account, so its entries stay put).
 * Cheap and idempotent; safe to call on every visit.
 */
export async function ensureBooks(ctx: Ctx) {
  const [keyed, banks] = await Promise.all([
    ctx.tx.ledgerHead.count({ where: { key: { in: STARTER_HEADS.map((h) => h.key) } } }),
    ctx.tx.bankAccount.count(),
  ]);
  if (keyed >= STARTER_HEADS.length && banks > 0) return;
  await lockBooks(ctx);
  const names = new Set((await ctx.tx.ledgerHead.findMany({ select: { name: true } })).map((h) => h.name.toLowerCase()));
  const have = new Set((await ctx.tx.ledgerHead.findMany({ where: { key: { not: null } }, select: { key: true } })).map((h) => h.key));
  const add = STARTER_HEADS.filter((h) => !have.has(h.key) && !names.has(h.name.toLowerCase()));
  if (add.length) {
    await ctx.tx.ledgerHead.createMany({ data: add.map((h) => ({ tenantId: ctx.tenantId, ...h })), skipDuplicates: true });
  }
  if (!(await ctx.tx.bankAccount.count())) {
    const main = await ctx.tx.bankAccount.create({ data: { tenantId: ctx.tenantId, name: "Main bank", ledgerCode: "BANK", isDefault: true } });
    await ctx.tx.ledgerAccount.updateMany({ where: { code: "BANK" }, data: { bankAccountId: main.id, name: main.name } });
  }
}

const cleanName = (s: unknown, what: string) => {
  const v = typeof s === "string" ? s.trim().replace(/\s+/g, " ") : "";
  if (v.length < 2 || v.length > 60) throw new MoneyError(`${what} must be 2 to 60 letters`);
  return v;
};
const isUnique = (e: unknown) => (e as { code?: string })?.code === "P2002";

export async function createHead(ctx: Ctx, input: { name: unknown; group: unknown; note?: unknown }) {
  const name = cleanName(input.name, "The head's name");
  const group = input.group as AccountGroup;
  if (!HEAD_GROUPS.includes(group)) throw new MoneyError("Pick where this head goes");
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 200) || null : null;
  return ctx.tx.ledgerHead.create({ data: { tenantId: ctx.tenantId, name, group, note } }).catch((e) => {
    if (isUnique(e)) throw new MoneyError(`There is already a head called ${name}`, 409);
    throw e;
  });
}

/** Rename, move to another group, hide or show a head. Its account follows. */
export async function updateHead(ctx: Ctx, id: string, input: { name?: unknown; group?: unknown; active?: unknown; note?: unknown }) {
  const h = await ctx.tx.ledgerHead.findUnique({ where: { id } });
  if (!h) throw new MoneyError("Account head not found", 404);
  const data: { name?: string; group?: AccountGroup; active?: boolean; note?: string | null } = {};
  if (input.name !== undefined) data.name = cleanName(input.name, "The head's name");
  if (input.group !== undefined) {
    if (!HEAD_GROUPS.includes(input.group as AccountGroup)) throw new MoneyError("Pick where this head goes");
    data.group = input.group as AccountGroup;
  }
  if (input.active !== undefined) data.active = !!input.active;
  if (input.note !== undefined) data.note = typeof input.note === "string" ? input.note.trim().slice(0, 200) || null : null;
  const out = await ctx.tx.ledgerHead.update({ where: { id }, data }).catch((e) => {
    if (isUnique(e)) throw new MoneyError(`There is already a head called ${data.name}`, 409);
    throw e;
  });
  if (data.name || data.group) {
    await ctx.tx.ledgerAccount.updateMany({ where: { headId: id }, data: { name: out.name, group: out.group } });
  }
  return { before: h, after: out };
}

type BankInput = { name?: unknown; kind?: unknown; bankName?: unknown; last4?: unknown; ifsc?: unknown; branch?: unknown; odLimit?: unknown };

function bankFields(input: BankInput, creating: boolean) {
  const data: { name?: string; kind?: BankKind; bankName?: string | null; last4?: string | null; ifsc?: string | null; branch?: string | null; odLimit?: number | null } = {};
  if (creating || input.name !== undefined) data.name = cleanName(input.name, "The account's name");
  if (input.kind !== undefined) {
    if (!(typeof input.kind === "string" && input.kind in BANK_KINDS)) throw new MoneyError("Pick the kind of account");
    data.kind = input.kind as BankKind;
  }
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) || null : null);
  if (input.bankName !== undefined) data.bankName = text(input.bankName, 80);
  if (input.branch !== undefined) data.branch = text(input.branch, 80);
  if (input.last4 !== undefined) {
    const v = text(input.last4, 4);
    if (v && !/^\d{4}$/.test(v)) throw new MoneyError("Last 4 digits must be 4 numbers");
    data.last4 = v;
  }
  if (input.ifsc !== undefined) {
    const v = text(input.ifsc, 11)?.toUpperCase() ?? null;
    if (v && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(v)) throw new MoneyError("IFSC looks wrong (like SBIN0001234)");
    data.ifsc = v;
  }
  if (input.odLimit !== undefined) {
    const v = input.odLimit === null || input.odLimit === "" ? null : Number(input.odLimit);
    if (v !== null && (!Number.isInteger(v) || v < 0 || v > 100_000_000_000)) throw new MoneyError("The limit must be ₹0 or more");
    data.odLimit = v;
  }
  return data;
}

export async function createBank(ctx: Ctx, input: BankInput & { makeDefault?: unknown }) {
  await ensureBooks(ctx);
  await lockBooks(ctx);
  const data = bankFields(input, true);
  const kind = data.kind ?? "CURRENT";
  if (kind !== "OD" && kind !== "CC") data.odLimit = null;
  const b = await ctx.tx.bankAccount
    .create({ data: { tenantId: ctx.tenantId, ...data, name: data.name!, kind, ledgerCode: `BANK:new:${crypto.randomUUID()}` } })
    .catch((e) => {
      if (isUnique(e)) throw new MoneyError(`There is already a bank account called ${data.name}`, 409);
      throw e;
    });
  const made = await ctx.tx.bankAccount.update({ where: { id: b.id }, data: { ledgerCode: `BANK:${b.id}` } });
  if (input.makeDefault) return setDefaultBank(ctx, made.id);
  return made;
}

async function bankBalance(ctx: Ctx, bankAccountId: string) {
  const agg = await ctx.tx.ledgerLine.aggregate({ where: { account: { bankAccountId } }, _sum: { amount: true } });
  return Number(agg._sum.amount ?? 0);
}

export async function updateBank(ctx: Ctx, id: string, input: BankInput & { active?: unknown }) {
  await lockBooks(ctx);
  const b = await ctx.tx.bankAccount.findUnique({ where: { id } });
  if (!b) throw new MoneyError("Bank account not found", 404);
  const data: ReturnType<typeof bankFields> & { active?: boolean } = bankFields(input, false);
  const kind = data.kind ?? b.kind;
  if (kind !== "OD" && kind !== "CC") data.odLimit = null;
  if (input.active !== undefined) {
    data.active = !!input.active;
    if (!data.active && b.active) {
      if (b.isDefault) throw new MoneyError("This is the default bank. Make another bank the default first.", 409);
      const bal = await bankBalance(ctx, id);
      if (bal !== 0) throw new MoneyError("This account still has money in the books. Move it out before closing it.", 409);
    }
  }
  const out = await ctx.tx.bankAccount.update({ where: { id }, data }).catch((e) => {
    if (isUnique(e)) throw new MoneyError(`There is already a bank account called ${data.name}`, 409);
    throw e;
  });
  if (data.name) await ctx.tx.ledgerAccount.updateMany({ where: { bankAccountId: id }, data: { name: out.name } });
  return { before: b, after: out };
}

/** Money with no bank chosen (cheques cleared, bank payments, matches) lands in the default bank. */
export async function setDefaultBank(ctx: Ctx, id: string) {
  await lockBooks(ctx);
  const b = await ctx.tx.bankAccount.findUnique({ where: { id } });
  if (!b) throw new MoneyError("Bank account not found", 404);
  if (!b.active) throw new MoneyError("Open this account again before making it the default", 409);
  await ctx.tx.bankAccount.updateMany({ where: { isDefault: true, id: { not: id } }, data: { isDefault: false } });
  return ctx.tx.bankAccount.update({ where: { id }, data: { isDefault: true } });
}

/**
 * Close the books up to a day (nothing dated on or before it can be posted or
 * reversed). Moving the lock forward is for the accountant; opening closed
 * days again (moving it back, or clearing it) only the owner may do.
 */
export async function setBooksLock(ctx: Ctx, until: string | null, isOwner: boolean) {
  if (until !== null && !isDay(until)) throw new MoneyError("Pick a date");
  if (until !== null && until > todayIst()) throw new MoneyError("The books can only be closed up to today");
  const t = await ctx.tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { booksLockedUntil: true } });
  const current = t.booksLockedUntil ? t.booksLockedUntil.toISOString().slice(0, 10) : null;
  const opening = current !== null && (until === null || until < current);
  if (opening && !isOwner) throw new MoneyError("Only the owner can open closed days again", 403);
  await ctx.tx.tenant.update({ where: { id: ctx.tenantId }, data: { booksLockedUntil: until ? new Date(`${until}T00:00:00Z`) : null } });
  return { before: current, after: until };
}

export async function booksLock(ctx: Ctx) {
  const t = await ctx.tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { booksLockedUntil: true } });
  return t.booksLockedUntil ? t.booksLockedUntil.toISOString().slice(0, 10) : null;
}

// ───────────────────────────── names of accounts ─────────────────────────────

type AccLite = { id: string; code: string; type: AccountType; name: string; userId: string | null; retailerId: string | null; retailer?: { outletName: string } | null; supplier?: { name: string } | null };

async function userNames(ctx: Ctx, accounts: AccLite[]) {
  const ids = [...new Set(accounts.map((a) => a.userId).filter((v): v is string => !!v))];
  if (!ids.length) return new Map<string, string>();
  const users = await ctx.tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

/** The name a person reads: the shop's or staff member's name with what the account is. */
export function accountLabel(a: AccLite, users: Map<string, string>) {
  const shop = a.retailer?.outletName ?? "Shop";
  switch (a.type) {
    case "RECEIVABLE":
      return `${shop} (dues)`;
    case "WALLET":
      return `${shop} (wallet)`;
    case "WALLET_HOLD":
      return `${shop} (wallet reserved)`;
    case "STAFF_CASH":
      return `Cash with ${users.get(a.userId ?? "") ?? "staff"}`;
    case "PAYABLE":
      return `${a.supplier?.name ?? "Supplier"} (payable)`;
    case "CLAIMS_RECEIVABLE":
      return `${a.supplier?.name ?? "Supplier"} (claims)`;
    default:
      return a.name;
  }
}

const accSelect = { id: true, code: true, type: true, name: true, userId: true, retailerId: true, retailer: { select: { outletName: true } }, supplier: { select: { name: true } } } as const;

// ───────────────────────────── chart of accounts ─────────────────────────────

export type ChartRow = {
  key: string;
  name: string;
  group: AccountGroup;
  /** Debit positive. */
  balance: number;
  /** Where its ledger opens (null = several accounts rolled into one row). */
  code: string | null;
  href: string | null;
  count?: number;
  headId?: string;
  bankAccountId?: string;
  active: boolean;
  note?: string | null;
};
export type ChartGroup = { group: AccountGroup; label: string; side: Side; rows: ChartRow[]; total: number };

/** Every account with its balance, by group. Shops' and staff accounts are rolled up, one row each kind. */
export async function chartOfAccounts(ctx: Ctx, asOn?: string) {
  const sums = await ctx.tx.ledgerLine.groupBy({
    by: ["accountId"],
    where: asOn ? { entry: { occurredAt: { lte: dayEnd(asOn) } } } : undefined,
    _sum: { amount: true },
  });
  const bal = new Map(sums.map((s) => [s.accountId, Number(s._sum.amount ?? 0)]));
  const [accounts, heads, banks] = await Promise.all([
    ctx.tx.ledgerAccount.findMany({ select: { id: true, code: true, type: true, name: true, group: true, headId: true, bankAccountId: true } }),
    ctx.tx.ledgerHead.findMany({ orderBy: { name: "asc" } }),
    ctx.tx.bankAccount.findMany({ orderBy: [{ isDefault: "desc" }, { name: "asc" }] }),
  ]);
  const rows: ChartRow[] = [];
  const rolled = new Map<string, ChartRow>();
  const ROLL: Partial<Record<AccountType, { name: string; href: string }>> = {
    RECEIVABLE: { name: "Shops' dues", href: "/admin/khata" },
    WALLET: { name: "Shops' wallets", href: "/admin/khata" },
    WALLET_HOLD: { name: "Wallet money reserved for orders", href: "/admin/khata" },
    STAFF_CASH: { name: "Cash with staff", href: "/admin/cash" },
    PAYABLE: { name: "Suppliers' bills", href: "/admin/books/suppliers" },
    CLAIMS_RECEIVABLE: { name: "Claims on companies", href: "/admin/books/claims" },
  };
  const byHead = new Map<string, number>();
  const byBank = new Map<string, number>();
  for (const a of accounts) {
    const b = bal.get(a.id) ?? 0;
    const roll = ROLL[a.type];
    if (roll) {
      const r = rolled.get(a.type) ?? { key: a.type, name: roll.name, group: GROUP_OF[a.type as Exclude<AccountType, "HEAD">], balance: 0, code: null, href: roll.href, count: 0, active: true };
      r.balance += b;
      r.count = (r.count ?? 0) + 1;
      rolled.set(a.type, r);
    } else if (a.headId) byHead.set(a.headId, (byHead.get(a.headId) ?? 0) + b);
    else if (a.bankAccountId) byBank.set(a.bankAccountId, (byBank.get(a.bankAccountId) ?? 0) + b);
    else rows.push({ key: a.code, name: a.name, group: a.group, balance: b, code: a.code, href: ledgerHref(a.code), active: true });
  }
  rows.push(...rolled.values());
  for (const h of heads) {
    const code = `HEAD:${h.id}`;
    rows.push({ key: code, name: h.name, group: h.group, balance: byHead.get(h.id) ?? 0, code, href: ledgerHref(code), headId: h.id, active: h.active, note: h.note });
  }
  for (const b of banks) {
    rows.push({ key: b.ledgerCode, name: b.name, group: "BANK", balance: byBank.get(b.id) ?? 0, code: b.ledgerCode, href: ledgerHref(b.ledgerCode), bankAccountId: b.id, active: b.active, note: b.isDefault ? "Default" : null });
  }
  const groups: ChartGroup[] = GROUP_ORDER.map((g) => {
    const rs = rows.filter((r) => r.group === g).sort((x, y) => x.name.localeCompare(y.name));
    return { group: g, label: GROUPS[g].label, side: GROUPS[g].side, rows: rs, total: rs.reduce((s, r) => s + r.balance, 0) };
  }).filter((g) => g.rows.length);
  const debit = rows.reduce((s, r) => s + Math.max(0, r.balance), 0);
  const credit = rows.reduce((s, r) => s + Math.max(0, -r.balance), 0);
  return { groups, debit, credit, difference: debit - credit };
}

export const ledgerHref = (code: string) => `/admin/books/ledger?account=${encodeURIComponent(code)}`;

/** Accounts a ledger can be opened for from the picker (shops' accounts open from their khata). */
export async function ledgerChoices(ctx: Ctx) {
  const [accounts, heads, banks] = await Promise.all([
    ctx.tx.ledgerAccount.findMany({ where: { type: { notIn: ["RECEIVABLE", "WALLET", "WALLET_HOLD", "HEAD", "PAYABLE", "CLAIMS_RECEIVABLE"] }, bankAccountId: null }, select: accSelect }),
    ctx.tx.ledgerHead.findMany({ orderBy: { name: "asc" } }),
    ctx.tx.bankAccount.findMany({ orderBy: [{ isDefault: "desc" }, { name: "asc" }] }),
  ]);
  const users = await userNames(ctx, accounts);
  const out: { code: string; label: string; group: string }[] = [
    ...banks.map((b) => ({ code: b.ledgerCode, label: `${b.name}${b.active ? "" : " (closed)"}`, group: GROUPS.BANK.label })),
    ...accounts
      .filter((a) => !(a.type === "BANK" && banks.length))
      .map((a) => ({ code: a.code, label: accountLabel(a, users), group: GROUPS[GROUP_OF[a.type as Exclude<AccountType, "HEAD">]].label })),
    ...heads.map((h) => ({ code: `HEAD:${h.id}`, label: `${h.name}${h.active ? "" : " (hidden)"}`, group: GROUPS[h.group].label })),
  ];
  return out.sort((x, y) => x.group.localeCompare(y.group) || x.label.localeCompare(y.label));
}

/** Where an entry made by a voucher (or its reversal) opens. */
async function voucherLinks(ctx: Ctx, entries: { id: string; reversesId: string | null }[]) {
  const ids = [...new Set(entries.flatMap((e) => [e.id, e.reversesId]).filter((x): x is string => !!x))];
  if (!ids.length) return new Map<string, string>();
  const vs = await ctx.tx.voucher.findMany({ where: { entryId: { in: ids } }, select: { id: true, entryId: true } });
  const by = new Map(vs.map((v) => [v.entryId!, `/admin/books/vouchers/${v.id}`]));
  const out = new Map<string, string>();
  for (const e of entries) {
    const h = by.get(e.id) ?? (e.reversesId ? by.get(e.reversesId) : undefined);
    if (h) out.set(e.id, h);
  }
  return out;
}

// ───────────────────────────── ledger ─────────────────────────────

const LINE_CAP = 3000;

export type LedgerRow = { entryId: string; date: string; kind: EntryKind; kindLabel: string; memo: string | null; against: string; debit: number; credit: number; balance: number; href: string | null };

/** One account for a period: opening, every entry with the other side, running balance, closing. */
export async function accountLedger(ctx: Ctx, code: string, from: string, to: string) {
  const acc = await ctx.tx.ledgerAccount.findUnique({ where: { tenantId_code: { tenantId: ctx.tenantId, code } }, select: { ...accSelect, group: true } });
  let name: string;
  let group: AccountGroup;
  if (acc) {
    name = accountLabel(acc, await userNames(ctx, [acc]));
    group = acc.group;
  } else if (code.startsWith("HEAD:")) {
    const h = await ctx.tx.ledgerHead.findUnique({ where: { id: code.slice(5) } });
    if (!h) throw new MoneyError("Account not found", 404);
    [name, group] = [h.name, h.group];
  } else {
    const b = await ctx.tx.bankAccount.findFirst({ where: { ledgerCode: code } });
    if (b) [name, group] = [b.name, "BANK"];
    else if (code.startsWith("PAYABLE:") || code.startsWith("CLAIMS_RECEIVABLE:")) {
      const sup = await ctx.tx.supplier.findUnique({ where: { id: code.split(":")[1] }, select: { name: true } });
      if (!sup) throw new MoneyError("Account not found", 404);
      const t = code.split(":")[0] as "PAYABLE" | "CLAIMS_RECEIVABLE";
      [name, group] = [`${sup.name} (${t === "PAYABLE" ? "payable" : "claims"})`, GROUP_OF[t]];
    } else if (code in NAMES && code !== "HEAD") [name, group] = [NAMES[code as AccountType], GROUP_OF[code as Exclude<AccountType, "HEAD">]];
    else throw new MoneyError("Account not found", 404);
  }
  const empty = { code, name, group, groupLabel: GROUPS[group].label, from, to, opening: 0, closing: 0, debit: 0, credit: 0, rows: [] as LedgerRow[], capped: false };
  if (!acc) return empty;

  const before = await ctx.tx.ledgerLine.aggregate({ where: { accountId: acc.id, entry: { occurredAt: { lt: dayStart(from) } } }, _sum: { amount: true } });
  const lines = await ctx.tx.ledgerLine.findMany({
    where: { accountId: acc.id, entry: { occurredAt: { gte: dayStart(from), lte: dayEnd(to) } } },
    include: {
      entry: {
        select: {
          id: true,
          kind: true,
          memo: true,
          occurredAt: true,
          retailerId: true,
          supplierId: true,
          reversesId: true,
          lines: { select: { accountId: true, amount: true, account: { select: accSelect } } },
        },
      },
    },
    orderBy: [{ entry: { occurredAt: "asc" } }, { createdAt: "asc" }],
    take: LINE_CAP + 1,
  });
  const capped = lines.length > LINE_CAP;
  const used = lines.slice(0, LINE_CAP);
  const users = await userNames(ctx, used.flatMap((l) => l.entry.lines.map((x) => x.account)));
  const vlink = await voucherLinks(ctx, used.map((l) => l.entry));
  let running = Number(before._sum.amount ?? 0);
  const opening = running;
  let debit = 0;
  let credit = 0;
  const rows: LedgerRow[] = used.map((l) => {
    running += l.amount;
    if (l.amount > 0) debit += l.amount;
    else credit -= l.amount;
    const others = l.entry.lines.filter((x) => x.accountId !== acc.id && Math.sign(x.amount) !== Math.sign(l.amount));
    const names = [...new Set(others.map((x) => accountLabel(x.account, users)))];
    return {
      entryId: l.entry.id,
      date: istDayText(l.entry.occurredAt),
      kind: l.entry.kind,
      kindLabel: KIND_LABEL[l.entry.kind],
      memo: l.entry.memo,
      against: names.length > 2 ? `${names.slice(0, 2).join(", ")} and ${names.length - 2} more` : names.join(", "),
      debit: l.amount > 0 ? l.amount : 0,
      credit: l.amount < 0 ? -l.amount : 0,
      balance: running,
      href: vlink.get(l.entry.id) ?? (l.entry.retailerId ? `/admin/khata/${l.entry.retailerId}` : l.entry.supplierId ? `/admin/books/suppliers/${l.entry.supplierId}` : null),
    };
  });
  return { ...empty, opening, closing: running, debit, credit, rows, capped };
}

// ───────────────────────────── day book ─────────────────────────────

const ENTRY_CAP = 1000;

export type DayBookEntry = {
  id: string;
  date: string;
  time: string;
  kind: EntryKind;
  kindLabel: string;
  memo: string | null;
  reversed: boolean;
  href: string | null;
  lines: { account: string; debit: number; credit: number }[];
  total: number;
};

/** Every entry of a day or a period, by voucher type, with its lines. Debits always equal credits. */
export async function dayBook(ctx: Ctx, from: string, to: string, kind?: EntryKind | null) {
  const entries = await ctx.tx.journalEntry.findMany({
    where: { occurredAt: { gte: dayStart(from), lte: dayEnd(to) }, ...(kind ? { kind } : {}) },
    select: {
      id: true,
      kind: true,
      memo: true,
      occurredAt: true,
      retailerId: true,
      supplierId: true,
      reversesId: true,
      reversedBy: { select: { id: true } },
      lines: { select: { amount: true, account: { select: accSelect } }, orderBy: { amount: "desc" } },
    },
    orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }],
    take: ENTRY_CAP + 1,
  });
  const capped = entries.length > ENTRY_CAP;
  const used = entries.slice(0, ENTRY_CAP);
  const users = await userNames(ctx, used.flatMap((e) => e.lines.map((l) => l.account)));
  const vlink = await voucherLinks(ctx, used);
  const byKind = new Map<EntryKind, { count: number; amount: number }>();
  let debit = 0;
  let credit = 0;
  const out: DayBookEntry[] = used.map((e) => {
    const lines = e.lines.map((l) => ({ account: accountLabel(l.account, users), debit: l.amount > 0 ? l.amount : 0, credit: l.amount < 0 ? -l.amount : 0 }));
    const total = lines.reduce((s, l) => s + l.debit, 0);
    debit += total;
    credit += lines.reduce((s, l) => s + l.credit, 0);
    const k = byKind.get(e.kind) ?? { count: 0, amount: 0 };
    byKind.set(e.kind, { count: k.count + 1, amount: k.amount + total });
    return {
      id: e.id,
      date: istDayText(e.occurredAt),
      time: e.occurredAt.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }),
      kind: e.kind,
      kindLabel: KIND_LABEL[e.kind],
      memo: e.memo,
      reversed: !!e.reversedBy,
      href: vlink.get(e.id) ?? (e.retailerId ? `/admin/khata/${e.retailerId}` : e.supplierId ? `/admin/books/suppliers/${e.supplierId}` : null),
      lines,
      total,
    };
  });
  const kinds = [...byKind.entries()].map(([k, v]) => ({ kind: k, label: KIND_LABEL[k], ...v })).sort((a, b) => b.amount - a.amount);
  return { from, to, kind: kind ?? null, entries: out, kinds, debit, credit, capped };
}

// ───────────────────────────── books check ─────────────────────────────

export type CheckResult = { key: string; title: string; ok: boolean; found: number; detail: string; fix: string };

const n = (v: unknown) => Number(v ?? 0);

/**
 * The books check: proofs that the ledger is whole and agrees with the bills
 * and payments. Each line says, in plain words, what was checked and what to
 * do if it fails. Runs inside the tenant (RLS limits every query to it).
 */
export async function checkBooks(ctx: Ctx): Promise<{ ok: boolean; results: CheckResult[]; counts: { entries: number; lines: number } }> {
  const q = async (sql: TemplateStringsArray, ...v: unknown[]) => n(((await ctx.tx.$queryRaw<{ c: bigint }[]>(sql, ...v))[0] ?? { c: 0 }).c);
  const t = ctx.tenantId;
  const [entries, lines] = await Promise.all([ctx.tx.journalEntry.count(), ctx.tx.ledgerLine.count()]);

  const unbalanced = await q`SELECT count(*) c FROM (SELECT "entryId" FROM "LedgerLine" WHERE "tenantId" = ${t} GROUP BY "entryId" HAVING sum(amount) <> 0) x`;
  const total = await q`SELECT coalesce(sum(amount), 0) c FROM "LedgerLine" WHERE "tenantId" = ${t}`;
  const oneSided = await q`SELECT count(*) c FROM (SELECT e.id FROM "JournalEntry" e LEFT JOIN "LedgerLine" l ON l."entryId" = e.id WHERE e."tenantId" = ${t} GROUP BY e.id HAVING count(l.id) < 2) x`;
  const billRange = await q`WITH al AS (SELECT "billId", sum(amount) s FROM "PaymentAllocation" WHERE "tenantId" = ${t} GROUP BY "billId")
    SELECT count(*) c FROM "Bill" b LEFT JOIN al ON al."billId" = b.id WHERE b."tenantId" = ${t} AND (b.paid < 0 OR b.paid > b.amount OR b.paid < coalesce(al.s, 0) OR (b.kind <> 'OPENING' AND b.paid <> coalesce(al.s, 0)))`;
  const settledFlag = await q`SELECT count(*) c FROM "Bill" WHERE "tenantId" = ${t} AND settled <> (paid >= amount)`;
  const payAlloc = await q`WITH al AS (SELECT "paymentId", sum(amount) s FROM "PaymentAllocation" WHERE "tenantId" = ${t} GROUP BY "paymentId")
    SELECT count(*) c FROM "Payment" p LEFT JOIN al ON al."paymentId" = p.id WHERE p."tenantId" = ${t} AND (p.allocated <> coalesce(al.s, 0) OR p.allocated > p.amount OR p.allocated < 0)`;
  const unconfirmed = await q`SELECT count(*) c FROM "Payment" WHERE "tenantId" = ${t} AND state <> 'CONFIRMED' AND allocated > 0`;
  const shops = await q`WITH recv AS (
      SELECT a."retailerId" r, sum(l.amount) bal FROM "LedgerAccount" a JOIN "LedgerLine" l ON l."accountId" = a.id
      WHERE a."tenantId" = ${t} AND a.type = 'RECEIVABLE' GROUP BY a."retailerId"),
    bills AS (SELECT "retailerId" r, sum(amount - paid) open FROM "Bill" WHERE "tenantId" = ${t} GROUP BY "retailerId"),
    unused AS (SELECT "retailerId" r, sum(amount - allocated) adv FROM "Payment" WHERE "tenantId" = ${t} AND state = 'CONFIRMED' AND purpose = 'DUES' GROUP BY "retailerId"),
    cmp AS (SELECT coalesce(recv.r, bills.r) r, coalesce(bal, 0) ledger, coalesce(open, 0) - coalesce(adv, 0) books
      FROM recv FULL JOIN bills ON bills.r = recv.r LEFT JOIN unused ON unused.r = coalesce(recv.r, bills.r))
    SELECT count(*) c FROM cmp WHERE ledger <> books`;
  const strayBank = await q`SELECT count(*) c FROM "LedgerAccount" WHERE "tenantId" = ${t} AND type = 'BANK' AND "bankAccountId" IS NULL
    AND EXISTS (SELECT 1 FROM "BankAccount" WHERE "tenantId" = ${t})`;
  const strayHead = await q`SELECT count(*) c FROM "LedgerAccount" a LEFT JOIN "LedgerHead" h ON h.id = a."headId" WHERE a."tenantId" = ${t} AND a.type = 'HEAD' AND (h.id IS NULL OR h."group" <> a."group")`;
  const defaults = await q`SELECT count(*) c FROM "BankAccount" WHERE "tenantId" = ${t} AND "isDefault"`;
  const banks = await q`SELECT count(*) c FROM "BankAccount" WHERE "tenantId" = ${t}`;
  const supBills = await q`WITH al AS (SELECT "billId", sum(amount) s FROM "SupplierAllocation" WHERE "tenantId" = ${t} GROUP BY "billId")
    SELECT count(*) c FROM "SupplierBill" b LEFT JOIN al ON al."billId" = b.id WHERE b."tenantId" = ${t}
    AND (b.paid < 0 OR b.paid > b.amount OR b.paid < coalesce(al.s, 0) OR (b.kind <> 'OPENING' AND b.paid <> coalesce(al.s, 0)) OR b.settled <> (b.paid >= b.amount))`;
  const supCredits = await q`WITH al AS (SELECT "creditId", sum(amount) s FROM "SupplierAllocation" WHERE "tenantId" = ${t} GROUP BY "creditId")
    SELECT count(*) c FROM "SupplierCredit" p LEFT JOIN al ON al."creditId" = p.id WHERE p."tenantId" = ${t} AND (p.allocated <> coalesce(al.s, 0) OR p.allocated > p.amount OR p.allocated < 0)`;
  const suppliers = await q`WITH pay AS (
      SELECT a."supplierId" s, sum(l.amount) bal FROM "LedgerAccount" a JOIN "LedgerLine" l ON l."accountId" = a.id
      WHERE a."tenantId" = ${t} AND a.type = 'PAYABLE' AND a."supplierId" IS NOT NULL GROUP BY a."supplierId"),
    bills AS (SELECT "supplierId" s, sum(amount - paid) open FROM "SupplierBill" WHERE "tenantId" = ${t} GROUP BY "supplierId"),
    unused AS (SELECT "supplierId" s, sum(amount - allocated) adv FROM "SupplierCredit" WHERE "tenantId" = ${t} GROUP BY "supplierId"),
    cmp AS (SELECT coalesce(pay.s, bills.s, unused.s) s, coalesce(bal, 0) ledger, coalesce(adv, 0) - coalesce(open, 0) books
      FROM pay FULL JOIN bills ON bills.s = pay.s FULL JOIN unused ON unused.s = coalesce(pay.s, bills.s))
    SELECT count(*) c FROM cmp WHERE ledger <> books`;
  const cheques = await q`WITH acc AS (SELECT coalesce(sum(l.amount), 0) bal FROM "LedgerAccount" a JOIN "LedgerLine" l ON l."accountId" = a.id WHERE a."tenantId" = ${t} AND a.type = 'ISSUED_CHEQUES'),
    open AS (SELECT coalesce(sum(amount), 0) amt FROM "IssuedCheque" WHERE "tenantId" = ${t} AND status = 'ISSUED')
    SELECT CASE WHEN acc.bal + open.amt = 0 THEN 0 ELSE 1 END c FROM acc, open`;
  const claims = await q`WITH acc AS (SELECT a."supplierId" s, sum(l.amount) bal FROM "LedgerAccount" a JOIN "LedgerLine" l ON l."accountId" = a.id WHERE a."tenantId" = ${t} AND a.type = 'CLAIMS_RECEIVABLE' GROUP BY 1),
    cl AS (SELECT "supplierId" s, sum(amount - settled - "writtenOff") amt FROM "Claim" WHERE "tenantId" = ${t} AND "cancelledAt" IS NULL GROUP BY 1),
    st AS (SELECT c.id, c.settled, c."writtenOff", coalesce(sum(x.amount) FILTER (WHERE x.kind <> 'WRITE_OFF'), 0) got, coalesce(sum(x.amount) FILTER (WHERE x.kind = 'WRITE_OFF'), 0) lost
      FROM "Claim" c LEFT JOIN "ClaimSettlement" x ON x."claimId" = c.id AND x."reversedAt" IS NULL WHERE c."tenantId" = ${t} GROUP BY c.id)
    SELECT (SELECT count(*) FROM acc FULL JOIN cl ON acc.s = cl.s WHERE coalesce(acc.bal, 0) <> coalesce(cl.amt, 0)) + (SELECT count(*) FROM st WHERE settled <> got OR "writtenOff" <> lost) c`;
  const vouchers = await q`WITH vl AS (SELECT "voucherId" v, code, sum(amount) amt FROM "VoucherLine" WHERE "tenantId" = ${t} GROUP BY 1, 2),
    el AS (SELECT v.id v, a.code, sum(l.amount) amt FROM "Voucher" v JOIN "LedgerLine" l ON l."entryId" = v."entryId" JOIN "LedgerAccount" a ON a.id = l."accountId" WHERE v."tenantId" = ${t} GROUP BY 1, 2),
    diff AS (SELECT DISTINCT coalesce(vl.v, el.v) v FROM vl FULL JOIN el ON el.v = vl.v AND el.code = vl.code WHERE coalesce(vl.amt, 0) <> coalesce(el.amt, 0)),
    bad AS (SELECT v.id FROM "Voucher" v LEFT JOIN "JournalEntry" r ON r."reversesId" = v."entryId" WHERE v."tenantId" = ${t} AND (v."entryId" IS NULL OR (v."cancelledAt" IS NULL) <> (r.id IS NULL)))
    SELECT (SELECT count(*) FROM diff) + (SELECT count(*) FROM bad WHERE id NOT IN (SELECT v FROM diff)) c`;
  const cashBelow = await q`SELECT count(*) c FROM (SELECT a.id FROM "LedgerAccount" a JOIN "LedgerLine" l ON l."accountId" = a.id
    WHERE a."tenantId" = ${t} AND (a.type IN ('OFFICE_CASH', 'STAFF_CASH') OR (a.type = 'HEAD' AND a."group" = 'CASH')) GROUP BY a.id HAVING sum(l.amount) < 0) x`;
  const stockCounts = await q`WITH sc AS (SELECT id, "entryId", shortage - excess net FROM "StockCount" WHERE "tenantId" = ${t} AND mode = 'TRACKED' AND status = 'ACCEPTED'),
    el AS (SELECT l."entryId", sum(l.amount) amt FROM "LedgerLine" l JOIN "LedgerAccount" a ON a.id = l."accountId" WHERE l."tenantId" = ${t} AND a.type = 'STOCK_LOSS' GROUP BY 1)
    SELECT (SELECT count(*) FROM sc LEFT JOIN el ON el."entryId" = sc."entryId" WHERE coalesce(el.amt, 0) <> sc.net OR (sc.net <> 0 AND sc."entryId" IS NULL))
      + (SELECT count(*) FROM "JournalEntry" j WHERE j."tenantId" = ${t} AND j.kind = 'STOCK_COUNT' AND NOT EXISTS (SELECT 1 FROM "StockCount" s WHERE s."entryId" = j.id)) c`;
  const lock = await booksLock(ctx);
  const afterLock = lock
    ? await q`SELECT count(*) c FROM "JournalEntry" WHERE "tenantId" = ${t} AND "occurredAt" < ${dayEnd(lock)} AND "createdAt" > (SELECT coalesce(max("createdAt"), now()) FROM "AuditLog" WHERE "tenantId" = ${t} AND action = 'books.lock')`
    : 0;

  const results: CheckResult[] = [
    { key: "balanced", title: "Every entry balances", ok: !unbalanced, found: unbalanced, detail: unbalanced ? `${unbalanced} entries have debits that don't equal credits` : `All ${entries.toLocaleString("en-IN")} entries: debits equal credits`, fix: "Tell VBiz Pro support: entries can't be edited, so this needs a correcting entry." },
    { key: "trial", title: "Trial balance agrees", ok: total === 0, found: total === 0 ? 0 : 1, detail: total === 0 ? "All debits equal all credits" : `The ledger is off by ₹${(total / 100).toFixed(2)}`, fix: "Tell VBiz Pro support." },
    { key: "two-sided", title: "No one-sided entries", ok: !oneSided, found: oneSided, detail: oneSided ? `${oneSided} entries have fewer than two lines` : "Every entry has a debit and a credit side", fix: "Tell VBiz Pro support." },
    { key: "bills", title: "Bills' received amounts add up", ok: !billRange, found: billRange, detail: billRange ? `${billRange} bills show more or less received than the payments set against them` : "Every bill's received amount matches its payments", fix: "Open the shop's khata and press Re-match payments, or tell support." },
    { key: "settled", title: "Paid bills are marked paid", ok: !settledFlag, found: settledFlag, detail: settledFlag ? `${settledFlag} bills have the wrong paid / unpaid mark` : "Paid and unpaid marks are right", fix: "Open the shop's khata and press Re-match payments." },
    { key: "payments", title: "Payments are set against bills correctly", ok: !payAlloc, found: payAlloc, detail: payAlloc ? `${payAlloc} payments are set against more or less than they should be` : "Every payment's use matches its bills", fix: "Open the shop's khata and press Re-match payments." },
    { key: "unconfirmed", title: "Only confirmed money pays bills", ok: !unconfirmed, found: unconfirmed, detail: unconfirmed ? `${unconfirmed} unconfirmed payments are paying bills` : "No waiting or rejected payment pays a bill", fix: "Tell VBiz Pro support." },
    { key: "shops", title: "Each shop's dues match its bills", ok: !shops, found: shops, detail: shops ? `${shops} shops' khata balance differs from their open bills less unused payments` : "Every shop's khata equals its open bills less unused payments", fix: "Open the outstanding report to find the shop, then tell support." },
    { key: "banks", title: "Bank accounts are set up", ok: banks === 0 || (defaults === 1 && !strayBank), found: banks === 0 ? 0 : (defaults === 1 ? 0 : 1) + strayBank, detail: banks === 0 ? "Not set up yet (the books' first opening does it)" : defaults !== 1 ? "There must be exactly one default bank" : strayBank ? "Some bank money is not in any bank account" : "One default bank; all bank money sits in a bank account", fix: "Open Bank accounts and pick a default." },
    { key: "heads", title: "Heads sit in their groups", ok: !strayHead, found: strayHead, detail: strayHead ? `${strayHead} head accounts are out of step with their head` : "Every head's account is in the head's group", fix: "Rename the head (any change brings it back in step)." },
    { key: "supplier-bills", title: "Suppliers' bills' paid amounts add up", ok: !supBills, found: supBills, detail: supBills ? `${supBills} suppliers' bills show more or less paid than the notes and payments set against them` : "Every supplier's bill matches what is set against it", fix: "Tell VBiz Pro support." },
    { key: "supplier-credits", title: "Notes and payments to suppliers are set correctly", ok: !supCredits, found: supCredits, detail: supCredits ? `${supCredits} notes or payments to suppliers are set against more or less than they should be` : "Every note and payment to a supplier matches its bills", fix: "Tell VBiz Pro support." },
    { key: "suppliers", title: "Each supplier's account matches their bills", ok: !suppliers, found: suppliers, detail: suppliers ? `${suppliers} suppliers' accounts differ from their open bills less unused notes and payments` : "Every supplier's account equals their open bills less unused notes and payments", fix: "Open Books, Suppliers to find the supplier, then tell support." },
    { key: "issued-cheques", title: "Our uncleared cheques add up", ok: !cheques, found: cheques, detail: cheques ? "Cheques issued in the books differ from the cheques not yet cleared" : "Cheques issued in the books equal the cheques not yet cleared", fix: "Open Books, Payments, Cheques we wrote, then tell support." },
    { key: "claims", title: "Claims on companies add up", ok: !claims, found: claims, detail: claims ? "Claims receivable in the books differ from the claims still open" : "Each company's claims receivable equals its open claims", fix: "Open Books, Claims, then tell support." },
    { key: "vouchers", title: "Vouchers agree with the ledger", ok: !vouchers, found: vouchers, detail: vouchers ? `${vouchers} vouchers differ from their entries` : "Every voucher's lines are in the ledger as entered, and every cancelled one is reversed", fix: "Open Books, Vouchers, then tell support." },
    { key: "cash", title: "No cash below zero", ok: !cashBelow, found: cashBelow, detail: cashBelow ? `${cashBelow} cash accounts show less than nothing` : "Office cash, petty cash and staff cash are all ₹0 or more", fix: "Open the cash book: a payment from cash was entered before the cash came in, or a receipt or handover is missing." },
    { key: "stock-counts", title: "Stock counts agree with the ledger", ok: !stockCounts, found: stockCounts, detail: stockCounts ? `${stockCounts} stock counts differ from their stock shortage entries` : "Every accepted count's shortage and excess at cost is in stock shortage", fix: "Open Books, Stock, Counts, then tell support." },
    { key: "lock", title: "Nothing new in closed days", ok: !afterLock, found: afterLock, detail: lock ? (afterLock ? `${afterLock} entries were added on or before ${showDay(lock)} after the books were closed` : `Closed up to ${showDay(lock)}; nothing was added there since`) : "The books are not closed for any days yet", fix: "Ask the owner to look at the day book for those days." },
  ];
  return { ok: results.every((r) => r.ok), results, counts: { entries, lines } };
}
