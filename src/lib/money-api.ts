import { NextResponse } from "next/server";
import { MoneyError, type PaymentInput } from "@/lib/ledger";
import { keyBelongsTo } from "@/lib/storage";
import type { PayMethod } from "@/generated/prisma/client";

/** Turn a MoneyError into a JSON response; rethrow anything else. */
export function moneyFail(e: unknown) {
  if (e instanceof MoneyError) return NextResponse.json({ error: e.message }, { status: e.status });
  throw e;
}

/** ?from=YYYY-MM-DD&to=YYYY-MM-DD as IST day bounds (max 400 days). Null if absent or bad. */
export function parseRange(sp: URLSearchParams): { from: Date; to: Date } | null {
  const f = sp.get("from");
  const t = sp.get("to");
  if (!f || !t || !/^\d{4}-\d{2}-\d{2}$/.test(f) || !/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const from = new Date(`${f}T00:00:00+05:30`);
  const to = new Date(`${t}T23:59:59.999+05:30`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return null;
  if (to.getTime() - from.getTime() > 400 * 86_400_000) return null;
  return { from, to };
}

const COLLECT_METHODS: PayMethod[] = ["CASH", "UPI", "CHEQUE", "BANK"];

/**
 * Validate the money part of a request body. Amounts are paise. Returns an
 * error message, or the fields for recordPayment().
 */
export function parseCollect(
  body: Record<string, unknown> | null | undefined,
  tenantId: string,
  opts: { methods?: PayMethod[] } = {}
): string | Pick<PaymentInput, "amount" | "method" | "reference" | "proofKey" | "note" | "cheque"> {
  if (!body) return "Missing payment details";
  const methods = opts.methods ?? COLLECT_METHODS;
  const method = body.method as PayMethod;
  if (!methods.includes(method)) return `Payment method must be one of ${methods.join(", ")}`;
  const amount = Number(body.amount);
  if (!Number.isInteger(amount) || amount <= 0) return "Amount must be more than ₹0";
  const reference = typeof body.reference === "string" ? body.reference.trim().slice(0, 64) : "";
  if (method === "UPI" && !/^[A-Za-z0-9]{6,30}$/.test(reference)) return "Enter the UPI reference (UTR) number";
  const proofKey = typeof body.proofKey === "string" && keyBelongsTo(body.proofKey, tenantId) ? body.proofKey : null;
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 300) || null : null;

  let cheque: PaymentInput["cheque"] = null;
  if (method === "CHEQUE") {
    const c = (body.cheque ?? {}) as Record<string, unknown>;
    const number = String(c.number ?? "").trim();
    const bank = String(c.bank ?? "").trim();
    const date = new Date(String(c.date ?? ""));
    if (!/^\d{6}$/.test(number)) return "Cheque number must be 6 digits";
    if (bank.length < 2) return "Enter the bank name";
    if (Number.isNaN(date.getTime())) return "Enter the cheque date";
    cheque = { number, bank: bank.slice(0, 80), date };
  }
  return { amount, method, reference: reference || null, proofKey, note, cheque };
}
