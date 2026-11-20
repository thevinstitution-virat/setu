import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { chargeDebit, MoneyError, openingBalance, recordPayment, withMoney } from "@/lib/ledger";
import { moneyFail } from "@/lib/money-api";

/**
 * Manual khata adjustments (ledger.adjust). Amounts are paise.
 *   { action: "opening", retailerId, amount (+ owes us / − advance), asOf: YYYY-MM-DD }
 *   { action: "debit_note" | "penalty", retailerId, amount, note }
 *   { action: "credit_note", retailerId, amount, note }   // discount, return, goodwill
 */
export async function POST(req: Request) {
  const auth = await guard("ledger.adjust");
  if (!auth.ok) return auth.res;
  const { session, db, tenant } = auth;
  const body = await req.json().catch(() => null);
  const action = body?.action as string;
  const retailerId = typeof body?.retailerId === "string" ? body.retailerId : "";
  const amount = Number(body?.amount);
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 300) : "";

  const retailer = await db.retailerProfile.findUnique({ where: { id: retailerId }, select: { id: true } });
  if (!retailer) return NextResponse.json({ error: "Retailer not found" }, { status: 404 });
  if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 1_000_000_000) {
    return NextResponse.json({ error: "Enter an amount" }, { status: 400 });
  }
  if (action !== "opening" && amount < 0) return NextResponse.json({ error: "Amount must be more than ₹0" }, { status: 400 });
  if (action !== "opening" && note.length < 3) return NextResponse.json({ error: "Write what this is for" }, { status: 400 });

  let result: unknown;
  try {
    result = await withMoney(tenant.id, session.userId, async (ctx) => {
      if (action === "opening") {
        const asOf = /^\d{4}-\d{2}-\d{2}$/.test(body?.asOf ?? "") ? new Date(`${body.asOf}T00:00:00+05:30`) : new Date();
        if (asOf > new Date()) throw new MoneyError("The date can't be in the future");
        return openingBalance(ctx, retailerId, amount, asOf, note || "Opening balance");
      }
      if (action === "debit_note" || action === "penalty") {
        return chargeDebit(ctx, { retailerId, amount, kind: action === "penalty" ? "PENALTY" : "DEBIT_NOTE", note });
      }
      if (action === "credit_note") {
        return recordPayment(ctx, { retailerId, amount, method: "CREDIT_NOTE", purpose: "DUES", note, atOffice: true });
      }
      throw new MoneyError("Unknown action");
    });
  } catch (e) {
    return moneyFail(e);
  }
  await audit(db, { actorId: session.userId, action: `ledger.${action}`, entity: "RetailerProfile", entityId: retailerId, after: { amount, note }, ip: requestIp(req) });
  return NextResponse.json({ ok: true, result: result ?? null });
}
