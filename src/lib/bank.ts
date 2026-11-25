import type { BankLine, Prisma } from "@/generated/prisma/client";
import { withTenantTx } from "@/lib/db";
import { chequeAction, post, recordPayment, reverseEntry, verifyPayment, withMoney, type AccountRef, type Ctx } from "@/lib/ledger";
import { MoneyError } from "@/lib/money-error";
import { formatINR } from "@/lib/money";
import { parseCsv } from "@/lib/importers";
import { sha256 } from "@/lib/secrets";
import { recordSettlement } from "@/lib/gateway";
import { clearIssuedCheque, paySupplier } from "@/lib/supplier-payments";
import { createVoucher } from "@/lib/vouchers";

/**
 * Bank statement import (CSV or XLSX as the bank gives it) and matching.
 *
 * Each money-in line is matched to what it pays for:
 *  VERIFY        a payment a shop reported (UPI / bank) and is waiting: confirm it (UPI also lands in Bank)
 *  UPI_CLEAR     a confirmed UPI payment reaching the bank: Dr Bank / Cr UPI to be banked
 *  BANK_LINK     a confirmed bank transfer: link only (it was booked to Bank already)
 *  CHEQUE_CLEAR  a cheque: deposit (if not yet) and clear it
 *  SETTLEMENT    a gateway payout: link it, or book it here with its fee
 *  CASH_DEPOSIT  office cash paid in: a contra voucher, office cash to this bank
 *  VOUCHER_IN    a receipt voucher or contra already entered: link only
 *  NEW_RECEIPT   other money in (interest, capital, a loan): a receipt voucher entered here
 *  NEW_PAYMENT   money from a shop nobody recorded: a bank payment for that shop
 * A line with exactly one sure match (same amount and its reference in the
 * narration) is matched on import; the rest wait with suggestions. One
 * payment / cheque / payout matches one line.
 *
 * Each money-out line is matched to what we paid:
 *  SUPPLIER_PAY          a bank payment to a supplier already entered: link only
 *  ISSUED_CHEQUE         a cheque we wrote, paid by our bank: Dr Cheques issued / Cr Bank
 *  NEW_SUPPLIER_PAYMENT  a payment to a supplier nobody entered: entered here
 *  VOUCHER_OUT           a payment voucher or contra already entered: link only
 *  NEW_EXPENSE           an expense nobody entered (bank charges, rent …): a payment voucher entered here
 *
 * Either way, NEW_CONTRA enters money moved between this bank and our cash
 * or another of our banks as a contra voucher.
 *
 * A statement belongs to one of our bank accounts; what it books lands there.
 */

export const MAX_BYTES = 5 * 1024 * 1024;
export const MAX_LINES = 5000;
const IST = 330 * 60_000;
const DAY = 24 * 3600_000;

export type MatchKind =
  | "VERIFY"
  | "UPI_CLEAR"
  | "BANK_LINK"
  | "CHEQUE_CLEAR"
  | "SETTLEMENT"
  | "CASH_DEPOSIT"
  | "NEW_PAYMENT"
  | "SUPPLIER_PAY"
  | "ISSUED_CHEQUE"
  | "NEW_SUPPLIER_PAYMENT"
  | "VOUCHER_OUT"
  | "VOUCHER_IN"
  | "NEW_EXPENSE"
  | "NEW_RECEIPT"
  | "NEW_CONTRA";
export const MATCH_LABEL: Record<MatchKind, string> = {
  VERIFY: "Confirm reported payment",
  UPI_CLEAR: "UPI payment reached the bank",
  BANK_LINK: "Bank transfer already recorded",
  CHEQUE_CLEAR: "Cheque cleared",
  SETTLEMENT: "Gateway payout",
  CASH_DEPOSIT: "Cash deposited",
  NEW_PAYMENT: "New payment from a shop",
  SUPPLIER_PAY: "Payment to a supplier already entered",
  ISSUED_CHEQUE: "Our cheque was paid",
  NEW_SUPPLIER_PAYMENT: "New payment to a supplier",
  VOUCHER_OUT: "Voucher already entered",
  VOUCHER_IN: "Voucher already entered",
  NEW_EXPENSE: "New expense (payment voucher)",
  NEW_RECEIPT: "Other money in (receipt voucher)",
  NEW_CONTRA: "Moved between our cash and banks",
};
/** The kinds that match money going out (NEW_CONTRA goes either way). */
export const OUT_KINDS = new Set<MatchKind>(["SUPPLIER_PAY", "ISSUED_CHEQUE", "NEW_SUPPLIER_PAYMENT", "VOUCHER_OUT", "NEW_EXPENSE"]);
/** Kinds whose match points at a voucher (one line per direction of it). */
const VOUCHER_KINDS = new Set(["CASH_DEPOSIT", "VOUCHER_OUT", "VOUCHER_IN", "NEW_EXPENSE", "NEW_RECEIPT", "NEW_CONTRA"]);

export type Suggestion = {
  kind: MatchKind;
  ref: string | null;
  retailerId?: string | null;
  supplierId?: string | null;
  /** NEW_EXPENSE / NEW_RECEIPT: the head it most likely is. */
  headId?: string | null;
  /** NEW_CONTRA: the cash or bank on the other side. */
  otherCode?: string | null;
  label: string;
  amount: number;
  date?: string | null;
  exact: boolean;
};

// ───────────────────────────── parsing ─────────────────────────────

/** blankBalance: the statement has a balance column but this line's cell is empty (balance is then null). */
export type ParsedLine = { date: Date; narration: string; reference: string | null; debit: number; credit: number; balance: number | null; blankBalance?: true };
export type Parsed = { lines: ParsedLine[]; skipped: number; columns: Record<string, string> };

type Col = "date" | "narration" | "ref" | "debit" | "credit" | "amount" | "drcr" | "balance";

function headerCol(h: string): Col | null {
  const s = h.toLowerCase().replace(/[^a-z/ ]/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (/(dr|debit)\s*\/\s*(cr|credit)|(cr|credit)\s*\/\s*(dr|debit)|^type$|^txn type$/.test(s)) return "drcr";
  if (/balance/.test(s)) return "balance";
  if (/^(txn |tran |transaction |posting |value |book )?(date|dt)$|^date /.test(s)) return "date";
  if (/narration|description|particulars|remarks|details/.test(s)) return "narration";
  if (/withdraw|debit|^dr\b|paid out/.test(s)) return "debit";
  if (/deposit|credit|^cr\b|paid in/.test(s)) return "credit";
  if (/^(txn |transaction )?amount|^amt/.test(s)) return "amount";
  if (/ref|chq|cheque|utr|instrument/.test(s)) return "ref";
  return null;
}

/** Find the header row (banks put a few lines of account details above it). */
function findHeader(table: string[][]): { at: number; cols: Partial<Record<Col, number>> } | null {
  for (let r = 0; r < Math.min(table.length, 40); r++) {
    const cols: Partial<Record<Col, number>> = {};
    table[r].forEach((cell, i) => {
      const c = headerCol(cell ?? "");
      // First "date" wins (transaction date comes before value date).
      if (c && cols[c] === undefined) cols[c] = i;
    });
    if (cols.date !== undefined && cols.narration !== undefined && (cols.credit !== undefined || cols.amount !== undefined)) return { at: r, cols };
  }
  return null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** A statement date as IST midnight. */
export function parseBankDate(raw: string): Date | null {
  const s = raw.trim();
  if (!s) return null;
  let y: number, m: number, d: number;
  let r: RegExpMatchArray | null;
  if ((r = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) [y, m, d] = [+r[1], +r[2], +r[3]];
  else if ((r = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\b/))) [d, m, y] = [+r[1], +r[2], +r[3]];
  else if ((r = s.match(/^(\d{1,2})[\s/-]([A-Za-z]{3})[A-Za-z]*[\s/,-]+(\d{2}|\d{4})\b/))) {
    const mi = MONTHS.indexOf(r[2].toLowerCase());
    if (mi < 0) return null;
    [d, m, y] = [+r[1], mi + 1, +r[3]];
  } else if (/^\d{5}(\.\d+)?$/.test(s)) {
    // Excel serial day number.
    const t = Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * DAY;
    const dt = new Date(t);
    [y, m, d] = [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()];
  } else return null;
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  const t = Date.UTC(y, m - 1, d);
  if (new Date(t).getUTCDate() !== d) return null;
  return new Date(t - IST);
}

/** "1,23,456.70", "1234.5 Cr", "(500.00)", "-" → paise (sign kept). */
export function parseBankAmount(raw: string): number | null {
  let s = raw.trim();
  if (!s || s === "-" || s === "--") return 0;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1);
  }
  s = s.replace(/₹|inr|rs\.?/gi, "").replace(/,/g, "").trim();
  if (/\b(dr|debit)$/i.test(s)) sign = -sign;
  s = s.replace(/\s*(cr|dr|credit|debit)$/i, "").trim();
  if (s.startsWith("-")) {
    sign = -sign;
    s = s.slice(1);
  }
  const r = s.match(/^(\d+)(?:\.(\d{1,2}))?\d*$/);
  if (!r) return null;
  return sign * (Number(r[1]) * 100 + Number((r[2] ?? "0").padEnd(2, "0")));
}

async function readTable(bytes: Buffer, fileName: string): Promise<string[][]> {
  if (/\.xlsx$/i.test(fileName)) {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) return [];
    const table: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      for (let c = 1; c <= ws.columnCount; c++) {
        const v = row.getCell(c).value as unknown;
        if (v == null) cells.push("");
        else if (v instanceof Date) cells.push(`${v.getUTCFullYear()}-${v.getUTCMonth() + 1}-${v.getUTCDate()}`);
        else if (typeof v === "object" && v && "text" in v) cells.push(String((v as { text: unknown }).text));
        else if (typeof v === "object" && v && "result" in v) {
          const res = (v as { result: unknown }).result;
          cells.push(res instanceof Date ? `${res.getUTCFullYear()}-${res.getUTCMonth() + 1}-${res.getUTCDate()}` : String(res ?? ""));
        } else cells.push(String(v));
      }
      table.push(cells);
    });
    return table;
  }
  if (/\.(csv|txt)$/i.test(fileName)) return parseCsv(bytes.toString("utf8"));
  throw new MoneyError("Upload the statement as CSV or Excel (.xlsx)");
}

export async function parseStatement(bytes: Buffer, fileName: string): Promise<Parsed> {
  const table = await readTable(bytes, fileName);
  const h = findHeader(table);
  if (!h) throw new MoneyError("Could not find the columns. The statement needs a date, a narration and deposit (or amount) columns.");
  const { cols } = h;
  const cell = (row: string[], c: Col) => (cols[c] === undefined ? "" : String(row[cols[c]!] ?? "").trim());
  const lines: ParsedLine[] = [];
  let skipped = 0;
  for (const row of table.slice(h.at + 1)) {
    if (!row.some((c) => String(c ?? "").trim())) continue;
    const date = parseBankDate(cell(row, "date"));
    if (!date) {
      skipped++;
      continue;
    }
    let debit = 0;
    let credit = 0;
    if (cols.credit !== undefined || cols.debit !== undefined) {
      const cr = parseBankAmount(cell(row, "credit"));
      const dr = parseBankAmount(cell(row, "debit"));
      if (cr === null || dr === null) {
        skipped++;
        continue;
      }
      credit = Math.abs(cr);
      debit = Math.abs(dr);
    } else {
      const a = parseBankAmount(cell(row, "amount"));
      if (a === null) {
        skipped++;
        continue;
      }
      const t = cell(row, "drcr").toLowerCase();
      const isDebit = t ? /^(d|dr|debit|w)/.test(t) : a < 0;
      if (isDebit) debit = Math.abs(a);
      else credit = Math.abs(a);
    }
    if ((debit === 0) === (credit === 0)) {
      skipped++;
      continue;
    }
    const narration = cell(row, "narration").replace(/\s+/g, " ").slice(0, 500);
    // An empty balance cell is no balance, not ₹0.
    const balRaw = cols.balance !== undefined ? cell(row, "balance").trim() : "";
    const blankBalance = cols.balance !== undefined && (!balRaw || balRaw === "-" || balRaw === "--");
    const bal = cols.balance !== undefined && !blankBalance ? parseBankAmount(balRaw) : null;
    const ref = cell(row, "ref").replace(/\s+/g, "");
    lines.push({ date, narration, reference: (ref && !/^0+$/.test(ref) ? ref : refsIn(narration)[0] ?? null)?.slice(0, 60) ?? null, debit, credit, balance: bal, ...(blankBalance ? { blankBalance: true as const } : {}) });
    if (lines.length > MAX_LINES) throw new MoneyError(`A statement can have at most ${MAX_LINES} lines; upload a shorter period`);
  }
  if (!lines.length) throw new MoneyError("No lines with a date and an amount were found");
  return { lines, skipped, columns: Object.fromEntries(Object.entries(cols).map(([k, i]) => [k, table[h.at][i!]])) };
}

// ───────────────────────────── references ─────────────────────────────

const alnum = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const unzero = (s: string) => (/^\d+$/.test(s) ? s.replace(/^0+/, "") : s);

/** UTR / RRN / IMPS references in a narration (longest first). */
export function refsIn(narration: string): string[] {
  const tokens = narration.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  const out = tokens.filter((t) => (/^\d{9,22}$/.test(t) ? true : /^[A-Z]{4}[A-Z0-9]{8,18}$/.test(t) && /\d{6}/.test(t)));
  return [...new Set(out)].sort((a, b) => b.length - a.length);
}

/** Does this line carry that reference? Long references may sit inside a run of text; short ones (cheque numbers) must be a whole token. */
export function lineHasRef(line: Pick<BankLine, "narration" | "reference">, ref: string | null | undefined) {
  const r = unzero(alnum(ref));
  if (r.length < 4) return false;
  const tokens = new Set(
    `${line.narration} ${line.reference ?? ""}`
      .toUpperCase()
      .split(/[^A-Z0-9]+/)
      .filter(Boolean)
      .map(unzero)
  );
  if (tokens.has(r)) return true;
  return r.length >= 10 && alnum(`${line.narration} ${line.reference ?? ""}`).includes(r);
}

// A blank balance cell used to be read as 0: it still fingerprints as 0, so a statement uploaded before is not imported twice.
const fingerprintOf = (account: string, l: ParsedLine, n: number) =>
  sha256([account.toLowerCase(), l.date.toISOString(), l.narration, l.reference ?? "", l.debit, l.credit, l.balance ?? (l.blankBalance ? 0 : ""), n].join("|"));

// ───────────────────────────── import ─────────────────────────────

export async function importStatement(tenantId: string, actorId: string, input: { fileName: string; bankAccountId?: string | null; account?: string; bytes: Buffer }) {
  if (input.bytes.length > MAX_BYTES) throw new MoneyError("The file is larger than 5 MB");
  // Which of our bank accounts: the one picked, else the default. With no bank
  // accounts set up yet, the typed label alone.
  const bank = await withTenantTx(tenantId, async (tx) => {
    if (input.bankAccountId) {
      const b = await tx.bankAccount.findUnique({ where: { id: input.bankAccountId } });
      if (!b) throw new MoneyError("Bank account not found", 404);
      if (!b.active) throw new MoneyError(`${b.name} is closed`);
      return b;
    }
    return tx.bankAccount.findFirst({ where: { isDefault: true } });
  });
  const account = bank?.name.slice(0, 60) ?? ((input.account ?? "").trim().slice(0, 60) || "Main bank account");
  const parsed = await parseStatement(input.bytes, input.fileName);
  const seen = new Map<string, number>();
  const rows = parsed.lines.map((l) => {
    const base = fingerprintOf(account, l, 0);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return { ...l, fingerprint: n ? fingerprintOf(account, l, n) : base };
  });
  const dates = rows.map((r) => r.date.getTime());

  const statement = await withTenantTx(tenantId, async (tx) => {
    const known = new Set(
      (await tx.bankLine.findMany({ where: { fingerprint: { in: rows.map((r) => r.fingerprint) } }, select: { fingerprint: true } })).map((r) => r.fingerprint)
    );
    const fresh = rows.filter((r) => !known.has(r.fingerprint));
    const st = await tx.bankStatement.create({
      data: {
        fileName: input.fileName.slice(0, 120),
        account,
        bankAccountId: bank?.id ?? null,
        fromDate: new Date(Math.min(...dates)),
        toDate: new Date(Math.max(...dates)),
        lineCount: fresh.length,
        skipped: parsed.skipped,
        uploadedById: actorId,
      },
    });
    if (fresh.length) {
      await tx.bankLine.createMany({
        data: fresh.map((r) => ({
          statementId: st.id,
          date: r.date,
          narration: r.narration || "(no narration)",
          reference: r.reference,
          debit: r.debit,
          credit: r.credit,
          balance: r.balance,
          fingerprint: r.fingerprint,
          status: "UNMATCHED" as const,
        })),
      });
    }
    return { st, duplicates: rows.length - fresh.length, moneyOut: fresh.filter((r) => r.debit > 0).length };
  });
  const result = await matchOpen(tenantId, actorId, { statementId: statement.st.id });
  return { statement: statement.st, duplicates: statement.duplicates, moneyOut: statement.moneyOut, skipped: parsed.skipped, columns: parsed.columns, ...result };
}

// ───────────────────────────── suggestions ─────────────────────────────

type Pool = Awaited<ReturnType<typeof loadPool>>;

/** Everything a money-in line could be, loaded once per run. */
async function loadPool(tx: Ctx["tx"], from: Date) {
  const claimed = await tx.bankLine.findMany({ where: { status: "MATCHED", matchRef: { not: null } }, select: { matchKind: true, matchRef: true, debit: true } });
  const used = new Set(claimed.map((c) => c.matchRef!));
  // A contra between two of our banks is seen twice: going out of one, coming into the other.
  for (const c of claimed) if (VOUCHER_KINDS.has(c.matchKind ?? "")) used.add(`${c.matchRef}:${c.debit > 0 ? "out" : "in"}`);
  const payments = await tx.payment.findMany({
    where: {
      method: { in: ["UPI", "BANK"] },
      OR: [{ state: "PENDING_VERIFICATION" }, { state: "CONFIRMED", collectedAt: { gte: from } }],
    },
    select: { id: true, number: true, method: true, state: true, amount: true, reference: true, collectedAt: true, retailer: { select: { outletName: true } } },
  });
  const cheques = await tx.cheque.findMany({
    // A held post-dated cheque counts once its date has come (matching it banks it).
    where: { status: { in: ["RECEIVED", "DEPOSITED"] }, OR: [{ payment: { state: "CONFIRMED" } }, { payment: { state: "POST_DATED" }, chequeDate: { lte: new Date() } }] },
    select: { id: true, number: true, bank: true, status: true, depositedAt: true, createdAt: true, payment: { select: { amount: true, retailer: { select: { outletName: true } } } } },
  });
  const settlements = await tx.gatewaySettlement.findMany({ where: { settledAt: { gte: from } }, select: { id: true, providerRef: true, amount: true, utr: true, settledAt: true } });
  const shops = await tx.retailerProfile.findMany({ select: { id: true, outletName: true, gstin: true, user: { select: { phone: true } } } });
  // Money out: our payments to suppliers, our cheques, and who we pay.
  const supplierPayments = await tx.supplierPayment.findMany({
    where: { method: "BANK", cancelledAt: null, date: { gte: from } },
    select: { id: true, number: true, amount: true, reference: true, date: true, bankAccountId: true, supplier: { select: { name: true } } },
  });
  const ourCheques = await tx.issuedCheque.findMany({ where: { status: "ISSUED" }, select: { id: true, number: true, amount: true, date: true, bankAccountId: true, payee: true } });
  const suppliers = await tx.supplier.findMany({ where: { active: true }, select: { id: true, name: true, gstin: true, phone: true } });
  // Vouchers with a bank side: which bank, which way, how much.
  const banks = await tx.bankAccount.findMany({ select: { id: true, ledgerCode: true } });
  const bankOf = new Map(banks.map((b) => [b.ledgerCode, b.id]));
  const vlines = banks.length
    ? await tx.voucherLine.findMany({
        where: { code: { in: [...bankOf.keys()] }, voucher: { cancelledAt: null, type: { in: ["PAYMENT", "RECEIPT", "CONTRA"] }, date: { gte: from } } },
        select: { code: true, amount: true, voucher: { select: { id: true, number: true, type: true, date: true, party: true, reference: true, narration: true } } },
      })
    : [];
  const legs = vlines
    .map((l) => ({ ...l.voucher, bankAccountId: bankOf.get(l.code)!, dir: l.amount < 0 ? ("out" as const) : ("in" as const), amount: Math.abs(l.amount) }))
    .filter((l) => !used.has(`${l.id}:${l.dir}`));
  const heads = await tx.ledgerHead.findMany({ where: { active: true, key: { in: ["bank_charges", "interest_received", "interest_paid"] } }, select: { id: true, key: true } });
  return {
    legs,
    heads: new Map(heads.map((h) => [h.key!, h.id])),
    used,
    payments: payments.filter((p) => !used.has(p.id)),
    cheques: cheques.filter((c) => !used.has(c.id)),
    settlements: settlements.filter((s) => !used.has(s.id)),
    shops,
    supplierPayments: supplierPayments.filter((p) => !used.has(p.id)),
    ourCheques: ourCheques.filter((c) => !used.has(c.id)),
    suppliers,
  };
}

const near = (a: Date, b: Date, before: number, after: number) => b.getTime() >= a.getTime() - before * DAY && b.getTime() <= a.getTime() + after * DAY;
const ymd = (d: Date) => new Date(d.getTime() + IST).toISOString().slice(0, 10);

const NAME_STOP = new Set(["STORE", "STORES", "SHOP", "TRADERS", "TRADING", "ENTERPRISES", "GENERAL", "KIRANA", "MART", "AND", "THE", "SONS", "BROTHERS", "AGENCY", "AGENCIES", "CENTRE", "CENTER"]);

type Named = { id: string; name: string; gstin: string | null; phone: string | null };

/** Who a narration names: by GSTIN, phone, or every telling word of the name. Up to three. */
function guessNamed(rows: Named[], narration: string) {
  const up = narration.toUpperCase();
  const flat = alnum(narration);
  const out: { id: string; name: string; why: string }[] = [];
  const gst = up.match(/\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]/)?.[0];
  const phones = [...up.matchAll(/(?<!\d)(?:91)?([6-9]\d{9})(?!\d)/g)].map((m) => m[1]);
  const words = new Set(up.split(/[^A-Z0-9]+/).filter((w) => w.length >= 4 && !NAME_STOP.has(w)));
  for (const s of rows) {
    if (gst && s.gstin === gst) out.push({ id: s.id, name: s.name, why: "GSTIN" });
    else if (s.phone && phones.includes(s.phone)) out.push({ id: s.id, name: s.name, why: "phone" });
    else {
      const key = alnum(s.name);
      const sig = s.name.toUpperCase().split(/[^A-Z0-9]+/).filter((w) => w.length >= 4 && !NAME_STOP.has(w));
      if ((key.length >= 8 && flat.includes(key)) || (sig.length && sig.every((w) => words.has(w)))) out.push({ id: s.id, name: s.name, why: "name" });
    }
    if (out.length >= 3) break;
  }
  return out;
}
const guessShops = (pool: Pool, narration: string) => guessNamed(pool.shops.map((s) => ({ id: s.id, name: s.outletName, gstin: s.gstin, phone: s.user.phone })), narration);

/** What a money-out line could be. `bankId` is the statement's bank (null = any). */
function suggestOut(pool: Pool, line: Pick<BankLine, "date" | "narration" | "reference" | "debit">, bankId: string | null): Suggestion[] {
  const amount = line.debit;
  const sameBank = (id: string | null) => !bankId || !id || id === bankId;
  const out: Suggestion[] = [];
  for (const p of pool.supplierPayments) {
    if (p.amount !== amount || pool.used.has(p.id) || !sameBank(p.bankAccountId)) continue;
    const exact = !!p.reference && lineHasRef(line, p.reference) && near(line.date, p.date, 30, 5);
    if (!exact && !near(line.date, p.date, 10, 3)) continue;
    out.push({ kind: "SUPPLIER_PAY", ref: p.id, label: `${p.number} · ${p.supplier.name}${p.reference ? ` · ${p.reference}` : ""}`, amount: p.amount, date: p.date.toISOString().slice(0, 10), exact });
  }
  for (const c of pool.ourCheques) {
    if (c.amount !== amount || pool.used.has(c.id) || !sameBank(c.bankAccountId)) continue;
    // A cheque is paid on or after its date, within three months.
    const exact = lineHasRef(line, c.number) && near(line.date, c.date, 95, 1);
    if (!exact && !near(line.date, c.date, 30, 1)) continue;
    out.push({ kind: "ISSUED_CHEQUE", ref: c.id, label: `Our cheque ${c.number} to ${c.payee}`, amount: c.amount, date: c.date.toISOString().slice(0, 10), exact });
  }
  out.push(...legSuggestions(pool, line, amount, "out", bankId));
  for (const s of guessNamed(pool.suppliers, line.narration)) {
    out.push({ kind: "NEW_SUPPLIER_PAYMENT", ref: null, supplierId: s.id, label: `New payment to ${s.name} (matched by ${s.why})`, amount, exact: false });
  }
  const n = line.narration.toUpperCase();
  if (/\bATM\b|CASH WDL|CASH WITHDRAW|\bCWDR\b|\bSELF\b|BY SELF/.test(n)) {
    out.push({ kind: "NEW_CONTRA", ref: null, otherCode: "OFFICE_CASH", label: "Cash drawn out to office cash", amount, exact: false });
  }
  if (/CHG|CHRG|CHARGES|COMMISSION|\bCOMM\b|SMS ALERT|MIN BAL|\bAMC\b|GST ON|\bFEE\b|FEES|CHQ BOOK|STAMP/.test(n) && pool.heads.get("bank_charges")) {
    out.push({ kind: "NEW_EXPENSE", ref: null, headId: pool.heads.get("bank_charges"), label: "Bank charges (new payment voucher)", amount, exact: false });
  }
  if (/\bINT\b.*\b(DR|DEBIT|COLL|CHARGED)\b|INTEREST (DEBIT|CHARGED|APPLIED)|OD INT|CC INT/.test(n) && pool.heads.get("interest_paid")) {
    out.push({ kind: "NEW_EXPENSE", ref: null, headId: pool.heads.get("interest_paid"), label: "Interest paid (new payment voucher)", amount, exact: false });
  }
  return out.sort((a, b) => Number(b.exact) - Number(a.exact)).slice(0, 6);
}

/** Vouchers already entered with this bank, this way and this amount. */
function legSuggestions(pool: Pool, line: Pick<BankLine, "date" | "narration" | "reference">, amount: number, dir: "out" | "in", bankId: string | null): Suggestion[] {
  const out: Suggestion[] = [];
  for (const v of pool.legs) {
    if (v.dir !== dir || v.amount !== amount || (bankId && v.bankAccountId !== bankId) || pool.used.has(`${v.id}:${dir}`)) continue;
    const exact = (!!v.reference && lineHasRef(line, v.reference) && near(line.date, v.date, 30, 5)) || lineHasRef(line, v.number);
    if (!exact && !near(line.date, v.date, 10, 5)) continue;
    const what = v.party ?? v.narration ?? (v.type === "CONTRA" ? "Contra" : "");
    out.push({ kind: dir === "out" ? "VOUCHER_OUT" : "VOUCHER_IN", ref: v.id, label: `${v.number}${what ? ` · ${what.slice(0, 60)}` : ""}${v.reference ? ` · ${v.reference}` : ""}`, amount, date: v.date.toISOString().slice(0, 10), exact });
  }
  return out;
}

export function suggestFor(pool: Pool, line: Pick<BankLine, "date" | "narration" | "reference" | "credit" | "debit">, bankId: string | null = null): Suggestion[] {
  if (line.debit > 0) return suggestOut(pool, line, bankId);
  if (line.credit <= 0) return [];
  const out: Suggestion[] = [];
  for (const p of pool.payments) {
    if (p.amount !== line.credit || pool.used.has(p.id)) continue;
    const exact = !!p.reference && lineHasRef(line, p.reference) && near(line.date, p.collectedAt, 60, 5);
    if (!exact && !near(line.date, p.collectedAt, 10, 2)) continue;
    const kind: MatchKind = p.state === "PENDING_VERIFICATION" ? "VERIFY" : p.method === "UPI" ? "UPI_CLEAR" : "BANK_LINK";
    out.push({ kind, ref: p.id, label: `${p.number} · ${p.retailer.outletName} · ${p.method}${p.reference ? ` ${p.reference}` : ""}`, amount: p.amount, date: ymd(p.collectedAt), exact });
  }
  for (const c of pool.cheques) {
    if (c.payment.amount !== line.credit || pool.used.has(c.id)) continue;
    const exact = lineHasRef(line, c.number);
    if (!exact && !near(line.date, c.depositedAt ?? c.createdAt, 15, 1)) continue;
    out.push({ kind: "CHEQUE_CLEAR", ref: c.id, label: `Cheque ${c.number} (${c.bank}) · ${c.payment.retailer.outletName}`, amount: c.payment.amount, date: ymd(c.depositedAt ?? c.createdAt), exact });
  }
  for (const s of pool.settlements) {
    if (s.amount !== line.credit || pool.used.has(s.id)) continue;
    const exact = !!s.utr && lineHasRef(line, s.utr);
    if (!exact && !near(line.date, s.settledAt, 2, 4)) continue;
    out.push({ kind: "SETTLEMENT", ref: s.id, label: `Gateway payout ${s.providerRef}${s.utr ? ` · UTR ${s.utr}` : ""}`, amount: s.amount, date: ymd(s.settledAt), exact });
  }
  out.push(...legSuggestions(pool, line, line.credit, "in", bankId));
  const n = line.narration.toUpperCase();
  if (/\bCASH\b|\bCDM\b|BY CASH|CASH DEP/.test(n)) out.push({ kind: "CASH_DEPOSIT", ref: null, label: "Office cash paid into the bank", amount: line.credit, exact: false });
  if (/\bINT\b.*\b(CR|CREDIT|PAID|PD)\b|INTEREST (CREDIT|PAID)|\bINT\.? ?PD\b|SB INT/.test(n) && pool.heads.get("interest_received")) {
    out.push({ kind: "NEW_RECEIPT", ref: null, headId: pool.heads.get("interest_received"), label: "Interest received (new receipt voucher)", amount: line.credit, exact: false });
  }
  if (/RAZORPAY|SETTLEMENT|SETL/.test(n) && !out.some((s) => s.kind === "SETTLEMENT")) {
    out.push({ kind: "SETTLEMENT", ref: null, label: "Gateway payout not yet recorded (enter its fee)", amount: line.credit, exact: false });
  }
  for (const s of guessShops(pool, line.narration)) {
    out.push({ kind: "NEW_PAYMENT", ref: null, retailerId: s.id, label: `New bank payment from ${s.name} (matched by ${s.why})`, amount: line.credit, exact: false });
  }
  return out.sort((a, b) => Number(b.exact) - Number(a.exact)).slice(0, 6);
}

/**
 * (Re)suggest every open money-in line (of one statement, or all) and match
 * the sure ones. Runs on import and from the "Match again" button.
 */
export async function matchOpen(tenantId: string, actorId: string | null, opts: { statementId?: string } = {}) {
  const lines = await withTenantTx(tenantId, (tx) =>
    tx.bankLine.findMany({
      where: { status: { in: ["UNMATCHED", "SUGGESTED"] }, ...(opts.statementId ? { statementId: opts.statementId } : {}) },
      include: { statement: { select: { bankAccountId: true } } },
      orderBy: { date: "asc" },
    })
  );
  if (!lines.length) return { matched: 0, suggested: 0, unmatched: 0 };
  const from = new Date(Math.min(...lines.map((l) => l.date.getTime())) - 120 * DAY);
  const [pool, defaultBank] = await withTenantTx(tenantId, (tx) => Promise.all([loadPool(tx, from), tx.bankAccount.findFirst({ where: { isDefault: true }, select: { id: true } })]));
  let matched = 0;
  let suggested = 0;
  const sure: { line: { id: string }; s: Suggestion }[] = [];
  const updates: { id: string; status: "SUGGESTED" | "UNMATCHED"; suggestions: Suggestion[] }[] = [];
  for (const line of lines) {
    const s = suggestFor(pool, line, line.statement.bankAccountId ?? defaultBank?.id ?? null);
    const exact = s.filter((x) => x.exact && x.ref);
    if (exact.length === 1) {
      sure.push({ line, s: exact[0] });
      pool.used.add(VOUCHER_KINDS.has(exact[0].kind) ? `${exact[0].ref}:${line.debit > 0 ? "out" : "in"}` : exact[0].ref!);
    }
    updates.push({ id: line.id, status: s.length ? "SUGGESTED" : "UNMATCHED", suggestions: s });
  }
  await withTenantTx(tenantId, async (tx) => {
    for (const u of updates) await tx.bankLine.update({ where: { id: u.id }, data: { status: u.status, suggestions: u.suggestions as unknown as Prisma.InputJsonValue } });
  });
  for (const { line, s } of sure) {
    try {
      await matchLine(tenantId, actorId, line.id, { kind: s.kind, ref: s.ref }, "Matched automatically");
      matched++;
    } catch (e) {
      console.error("[bank] auto-match failed", line.id, (e as Error).message);
    }
  }
  for (const u of updates) if (u.status === "SUGGESTED" && !sure.some((x) => x.line.id === u.id)) suggested++;
  return { matched, suggested, unmatched: updates.length - matched - suggested };
}

// ───────────────────────────── matching ─────────────────────────────

export type MatchChoice = {
  kind: MatchKind;
  ref?: string | null;
  retailerId?: string | null;
  supplierId?: string | null;
  purpose?: "DUES" | "WALLET";
  fees?: number | null;
  /** NEW_EXPENSE / NEW_RECEIPT: the head. */
  headId?: string | null;
  /** NEW_CONTRA (and CASH_DEPOSIT from a cash head): the cash or bank on the other side. */
  otherCode?: string | null;
  /** NEW_EXPENSE / NEW_RECEIPT: paid to / received from. */
  party?: string | null;
};

const isBanked = async (ctx: Ctx, id: string) => !!(await ctx.tx.bankLine.findFirst({ where: { matchRef: id, status: "MATCHED" }, select: { id: true } }));

async function applyMatch(ctx: Ctx, line: BankLine & { statement: { bankAccountId: string | null } }, c: MatchChoice): Promise<{ ref: string | null; entryId: string | null }> {
  const out = c.kind === "NEW_CONTRA" ? line.debit > 0 : OUT_KINDS.has(c.kind);
  if (out ? line.debit <= 0 : line.credit <= 0) throw new MoneyError(out ? "That is for money going out" : "That is for money coming in");
  const amount = out ? line.debit : line.credit;
  // The statement's bank; the default bank when it names none.
  const stBank = line.statement.bankAccountId ? await ctx.tx.bankAccount.findUnique({ where: { id: line.statement.bankAccountId }, select: { id: true, name: true, isDefault: true } }) : null;
  const bankRef: AccountRef = stBank ? { type: "BANK", bankAccountId: stBank.id } : { type: "BANK" };
  const bankIn = async (memo: string, credit: "UPI_CLEARING" | "OFFICE_CASH") =>
    (
      await post(ctx, {
        kind: "BANK_MATCH",
        memo,
        occurredAt: line.date,
        lines: [
          { account: bankRef, amount },
          { account: { type: credit }, amount: -amount },
        ],
      })
    ).id;
  /** Shop money is booked to the default bank; when it landed in another, move it there. */
  const landed = async (memo: string) =>
    stBank && !stBank.isDefault
      ? (
          await post(ctx, {
            kind: "BANK_MATCH",
            memo: `${memo}: landed in ${stBank.name}`,
            occurredAt: line.date,
            lines: [
              { account: bankRef, amount },
              { account: { type: "BANK" }, amount: -amount },
            ],
          })
        ).id
      : null;
  /** This statement's bank as a ledger code (the default bank when it names none). */
  const bankCode = async () => {
    if (stBank) return (await ctx.tx.bankAccount.findUniqueOrThrow({ where: { id: stBank.id }, select: { ledgerCode: true } })).ledgerCode;
    return (await ctx.tx.bankAccount.findFirst({ where: { isDefault: true }, select: { ledgerCode: true } }))?.ledgerCode ?? "BANK";
  };
  const lineRef = () => (line.reference ?? refsIn(line.narration)[0] ?? "").slice(0, 60) || null;

  switch (c.kind) {
    case "VERIFY":
    case "UPI_CLEAR":
    case "BANK_LINK": {
      const p = c.ref ? await ctx.tx.payment.findUnique({ where: { id: c.ref } }) : null;
      if (!p || (p.method !== "UPI" && p.method !== "BANK")) throw new MoneyError("Payment not found", 404);
      if (p.amount !== amount) throw new MoneyError(`The payment is ${formatINR(p.amount)}, the bank line ${formatINR(amount)}`);
      if (await isBanked(ctx, p.id)) throw new MoneyError("That payment is already matched to another bank line", 409);
      if (c.kind === "VERIFY") {
        if (p.state !== "PENDING_VERIFICATION") throw new MoneyError("That payment is not waiting to be confirmed", 409);
        await verifyPayment(ctx, p.id, true);
        return { ref: p.id, entryId: p.method === "UPI" ? await bankIn(`UPI ${p.number} reached the bank`, "UPI_CLEARING") : await landed(p.number) };
      }
      if (p.state !== "CONFIRMED") throw new MoneyError("That payment is not confirmed", 409);
      if (c.kind === "UPI_CLEAR") {
        if (p.method !== "UPI") throw new MoneyError("That is not a UPI payment");
        return { ref: p.id, entryId: await bankIn(`UPI ${p.number} reached the bank`, "UPI_CLEARING") };
      }
      if (p.method !== "BANK") throw new MoneyError("That is not a bank transfer");
      return { ref: p.id, entryId: await landed(p.number) };
    }
    case "CHEQUE_CLEAR": {
      const ch = c.ref ? await ctx.tx.cheque.findUnique({ where: { id: c.ref }, include: { payment: true } }) : null;
      if (!ch) throw new MoneyError("Cheque not found", 404);
      if (ch.payment.amount !== amount) throw new MoneyError(`The cheque is ${formatINR(ch.payment.amount)}, the bank line ${formatINR(amount)}`);
      if (ch.status === "RECEIVED") await chequeAction(ctx, ch.id, "deposit");
      await chequeAction(ctx, ch.id, "clear");
      const e = await ctx.tx.journalEntry.findFirst({ where: { kind: "CHEQUE_CLEAR", paymentId: ch.paymentId }, orderBy: { createdAt: "desc" }, select: { id: true } });
      await landed(`Cheque ${ch.number}`);
      return { ref: ch.id, entryId: e?.id ?? null };
    }
    case "SETTLEMENT": {
      if (c.ref) {
        const s = await ctx.tx.gatewaySettlement.findUnique({ where: { id: c.ref } });
        if (!s) throw new MoneyError("Payout not found", 404);
        if (s.amount !== amount) throw new MoneyError(`The payout is ${formatINR(s.amount)}, the bank line ${formatINR(amount)}`);
        if (await isBanked(ctx, s.id)) throw new MoneyError("That payout is already matched", 409);
        return { ref: s.id, entryId: await landed(`Payout ${s.providerRef}`) };
      }
      const fees = c.fees ?? 0;
      if (!Number.isInteger(fees) || fees < 0 || fees > amount) throw new MoneyError("Enter the gateway fee (₹0 or more)");
      await recordSettlement(ctx, { provider: "bank", id: `bank_${line.id}`, amount, fees, tax: 0, utr: line.reference, at: line.date });
      const s = await ctx.tx.gatewaySettlement.findFirstOrThrow({ where: { providerRef: `bank_${line.id}` } });
      await landed("Gateway payout");
      return { ref: s.id, entryId: s.entryId };
    }
    case "CASH_DEPOSIT":
    case "NEW_CONTRA": {
      const other = c.kind === "CASH_DEPOSIT" ? c.otherCode || "OFFICE_CASH" : c.otherCode;
      if (!other) throw new MoneyError("Choose where the money went or came from", 400);
      const v = await createVoucher(ctx, {
        type: "CONTRA",
        date: ymd(line.date),
        fromCode: out ? await bankCode() : other,
        toCode: out ? other : await bankCode(),
        amount,
        reference: lineRef(),
        narration: `From the bank statement: ${line.narration.slice(0, 200)}`,
      });
      return { ref: v.id, entryId: v.entryId };
    }
    case "VOUCHER_OUT":
    case "VOUCHER_IN": {
      const v = c.ref ? await ctx.tx.voucher.findUnique({ where: { id: c.ref }, include: { lines: true } }) : null;
      if (!v) throw new MoneyError("Voucher not found", 404);
      if (v.cancelledAt) throw new MoneyError(`${v.number} was cancelled`, 409);
      const code = await bankCode();
      const leg = v.lines.find((l) => l.code === code && (out ? l.amount < 0 : l.amount > 0));
      if (!leg) throw new MoneyError(`${v.number} doesn't move money ${out ? "out of" : "into"} ${stBank?.name ?? "this bank"}`);
      if (Math.abs(leg.amount) !== amount) throw new MoneyError(`${v.number} is ${formatINR(Math.abs(leg.amount))}, the bank line ${formatINR(amount)}`);
      const taken = await ctx.tx.bankLine.findFirst({ where: { matchRef: v.id, status: "MATCHED", ...(out ? { debit: { gt: 0 } } : { credit: { gt: 0 } }) }, select: { id: true } });
      if (taken) throw new MoneyError("That voucher is already matched to another bank line", 409);
      return { ref: v.id, entryId: null };
    }
    case "NEW_EXPENSE":
    case "NEW_RECEIPT": {
      if (!c.headId) throw new MoneyError("Choose the head", 400);
      const bankId = stBank?.id ?? (await ctx.tx.bankAccount.findFirst({ where: { isDefault: true }, select: { id: true } }))?.id ?? null;
      const v = await createVoucher(ctx, {
        type: c.kind === "NEW_EXPENSE" ? "PAYMENT" : "RECEIPT",
        date: ymd(line.date),
        method: "BANK",
        bankAccountId: bankId,
        lines: [{ code: `HEAD:${c.headId}`, amount }],
        party: c.party ?? null,
        reference: lineRef(),
        narration: `From the bank statement: ${line.narration.slice(0, 200)}`,
      });
      return { ref: v.id, entryId: v.entryId };
    }
    case "NEW_PAYMENT": {
      const shop = c.retailerId ? await ctx.tx.retailerProfile.findUnique({ where: { id: c.retailerId }, select: { id: true } }) : null;
      if (!shop) throw new MoneyError("Choose the shop", 400);
      const p = await recordPayment(ctx, {
        retailerId: shop.id,
        amount,
        method: "BANK",
        purpose: c.purpose === "WALLET" ? "WALLET" : "DUES",
        reference: (line.reference ?? refsIn(line.narration)[0] ?? "").slice(0, 60) || null,
        collectorId: null,
        atOffice: true,
        note: "From the bank statement",
        occurredAt: line.date,
      });
      await landed(p.number);
      return { ref: p.id, entryId: p.entryId };
    }
    case "SUPPLIER_PAY": {
      const p = c.ref ? await ctx.tx.supplierPayment.findUnique({ where: { id: c.ref } }) : null;
      if (!p || p.method !== "BANK") throw new MoneyError("Payment to supplier not found", 404);
      if (p.cancelledAt) throw new MoneyError("That payment was cancelled", 409);
      if (p.amount !== amount) throw new MoneyError(`The payment is ${formatINR(p.amount)}, the bank line ${formatINR(amount)}`);
      if (stBank && p.bankAccountId !== stBank.id) throw new MoneyError(`That payment was made from another bank account, not ${stBank.name}`);
      if (await isBanked(ctx, p.id)) throw new MoneyError("That payment is already matched to another bank line", 409);
      return { ref: p.id, entryId: null };
    }
    case "ISSUED_CHEQUE": {
      const ch = c.ref ? await ctx.tx.issuedCheque.findUnique({ where: { id: c.ref } }) : null;
      if (!ch) throw new MoneyError("Cheque not found", 404);
      if (ch.amount !== amount) throw new MoneyError(`The cheque is ${formatINR(ch.amount)}, the bank line ${formatINR(amount)}`);
      if (stBank && ch.bankAccountId !== stBank.id) throw new MoneyError(`Cheque ${ch.number} is on another bank account, not ${stBank.name}`);
      const done = await clearIssuedCheque(ctx, ch.id, ymd(line.date));
      return { ref: ch.id, entryId: done.clearEntryId };
    }
    case "NEW_SUPPLIER_PAYMENT": {
      if (!c.supplierId) throw new MoneyError("Choose the supplier", 400);
      const p = await paySupplier(ctx, {
        supplierId: c.supplierId,
        date: ymd(line.date),
        method: "BANK",
        bankAccountId: stBank?.id ?? null,
        amount,
        reference: (line.reference ?? refsIn(line.narration)[0] ?? "").slice(0, 60) || null,
        note: "From the bank statement",
      });
      return { ref: p.id, entryId: p.entryId };
    }
  }
}

export async function matchLine(tenantId: string, actorId: string | null, lineId: string, choice: MatchChoice, note?: string | null) {
  return withMoney(tenantId, actorId, async (ctx) => {
    const line = await ctx.tx.bankLine.findUnique({ where: { id: lineId }, include: { statement: { select: { bankAccountId: true } } } });
    if (!line) throw new MoneyError("Bank line not found", 404);
    if (line.status === "MATCHED") throw new MoneyError("This line is already matched", 409);
    if (line.status === "IGNORED") throw new MoneyError("Bring the line back before matching it", 409);
    if (!(choice.kind in MATCH_LABEL)) throw new MoneyError("Choose what this money is");
    const r = await applyMatch(ctx, line, choice);
    try {
      return await ctx.tx.bankLine.update({
        where: { id: line.id },
        data: { status: "MATCHED", matchKind: choice.kind, matchRef: r.ref, entryId: r.entryId, note: note?.slice(0, 200) ?? null, matchedById: actorId, matchedAt: new Date() },
      });
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") throw new MoneyError("That is already matched to another bank line", 409);
      throw e;
    }
  });
}

/**
 * Undo a link that booked nothing of its own (a bank transfer already
 * recorded, a payout recorded elsewhere, a supplier payment entered already).
 * A move to the statement's bank made by the link is reversed with it.
 */
export async function unmatchLine(tenantId: string, actorId: string | null, lineId: string) {
  return withMoney(tenantId, actorId, async (ctx) => {
    const line = await ctx.tx.bankLine.findUnique({ where: { id: lineId } });
    if (!line || line.status !== "MATCHED") throw new MoneyError("This line is not matched", 409);
    const linkOnly =
      line.matchKind === "BANK_LINK" ||
      line.matchKind === "SUPPLIER_PAY" ||
      line.matchKind === "VOUCHER_OUT" ||
      line.matchKind === "VOUCHER_IN" ||
      (line.matchKind === "SETTLEMENT" && !(await ctx.tx.gatewaySettlement.findFirst({ where: { id: line.matchRef ?? "", providerRef: `bank_${line.id}` } })));
    if (!linkOnly) throw new MoneyError(VOUCHER_KINDS.has(line.matchKind ?? "") ? "This match entered a voucher; cancel the voucher instead" : "This match booked an entry; reverse the payment or entry instead", 409);
    if (line.entryId) await reverseEntry(ctx, line.entryId, "Bank line unmatched");
    return ctx.tx.bankLine.update({ where: { id: line.id }, data: { status: "UNMATCHED", matchKind: null, matchRef: null, entryId: null, matchedById: null, matchedAt: null, note: null } });
  });
}

export async function ignoreLine(tenantId: string, actorId: string | null, lineId: string, ignore: boolean, note?: string | null) {
  return withMoney(tenantId, actorId, async (ctx) => {
    const line = await ctx.tx.bankLine.findUnique({ where: { id: lineId } });
    if (!line) throw new MoneyError("Bank line not found", 404);
    if (line.status === "MATCHED") throw new MoneyError("This line is matched", 409);
    if (ignore) return ctx.tx.bankLine.update({ where: { id: line.id }, data: { status: "IGNORED", note: note?.slice(0, 200) || "Not ours to match", matchedById: actorId, matchedAt: new Date() } });
    if (line.status !== "IGNORED") throw new MoneyError("This line is not set aside", 409);
    return ctx.tx.bankLine.update({ where: { id: line.id }, data: { status: "UNMATCHED", note: null, matchedById: null, matchedAt: null } });
  });
}
