import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { moneyFail } from "@/lib/money-api";
import { MoneyError, withMoney } from "@/lib/ledger";
import { fileResponse } from "@/lib/books-export";
import { cancelClaim, claimDetail, receiveOnClaim, reverseSettlement, writeOffClaim } from "@/lib/claims";
import { letterCsv, letterSheet } from "@/lib/claims-export";

type P = { params: Promise<{ id: string }> };

/** GET: one claim. ?format=pdf|csv: the claim letter to send to the company. */
export async function GET(req: Request, { params }: P) {
  const auth = await guard("accounts.view");
  if (!auth.ok) return auth.res;
  const { id } = await params;
  const format = new URL(req.url).searchParams.get("format");
  try {
    const claim = await withMoney(auth.tenant.id, auth.session.userId, (ctx) => claimDetail(ctx, id));
    if (format === "pdf" || format === "csv") {
      const t = await auth.db.tenant.findUniqueOrThrow({ where: { id: auth.tenant.id }, select: { name: true, legalName: true } });
      return fileResponse(auth.db, auth.tenant.id, format, `claim-${claim.number}`, letterCsv(claim), letterSheet(claim, { name: t.legalName || t.name }));
    }
    return NextResponse.json({ claim }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return moneyFail(e);
  }
}

type Body = {
  action?: string;
  reason?: string;
  date?: string;
  amount?: number | null;
  bankAccountId?: string | null;
  cash?: boolean;
  reference?: string | null;
  note?: string | null;
  settlementId?: string;
};
const ACTIONS = ["receive", "writeoff", "undo", "cancel"];

/**
 * POST { action }:
 *  - receive { date, amount, bankAccountId? | cash, reference?, note? }: money from the company.
 *  - writeoff { date, reason, amount? (blank = all that is open) }: rejected, or not worth chasing.
 *  - undo { settlementId, reason }: money received or a write-off entered by mistake.
 *  - cancel { reason }: the claim was raised by mistake (nothing against it yet).
 */
export async function POST(req: Request, { params }: P) {
  const auth = await guard("claims.manage");
  if (!auth.ok) return auth.res;
  const { id } = await params;
  const b = ((await req.json().catch(() => null)) ?? {}) as Body;
  if (!b.action || !ACTIONS.includes(b.action)) return NextResponse.json({ error: `Action is ${ACTIONS.join(", ")}` }, { status: 400 });
  try {
    await withMoney(auth.tenant.id, auth.session.userId, async (ctx) => {
      if (b.action === "receive")
        return receiveOnClaim(ctx, id, { date: String(b.date ?? ""), amount: Number(b.amount), bankAccountId: b.bankAccountId, cash: !!b.cash, reference: b.reference, note: b.note });
      if (b.action === "writeoff") return writeOffClaim(ctx, id, { date: String(b.date ?? ""), reason: String(b.reason ?? ""), amount: b.amount });
      if (b.action === "undo") {
        const st = await ctx.tx.claimSettlement.findUnique({ where: { id: String(b.settlementId ?? "") }, select: { claimId: true } });
        if (!st || st.claimId !== id) throw new MoneyError("Not found", 404);
        return reverseSettlement(ctx, String(b.settlementId), String(b.reason ?? ""));
      }
      return cancelClaim(ctx, id, String(b.reason ?? ""));
    });
    await audit(auth.db, {
      actorId: auth.session.userId,
      action: `claim.${b.action}`,
      entity: "Claim",
      entityId: id,
      after: { amount: b.amount ?? null, reason: b.reason ?? null, settlementId: b.settlementId ?? null },
      ip: requestIp(req),
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return moneyFail(e);
  }
}
