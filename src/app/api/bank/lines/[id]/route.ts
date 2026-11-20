import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { moneyFail } from "@/lib/money-api";
import { ignoreLine, matchLine, MATCH_LABEL, unmatchLine, type MatchKind } from "@/lib/bank";

type P = { params: Promise<{ id: string }> };

/**
 * Body: { action: "match", kind, ref?, retailerId?, purpose?, fees? (paise), note? }
 *     | { action: "unmatch" } | { action: "ignore", note? } | { action: "unignore" }
 */
export async function POST(req: Request, { params }: P) {
  const auth = await guard("bank.reconcile");
  if (!auth.ok) return auth.res;
  const { session, db, tenant } = auth;
  const { id } = await params;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  try {
    let line;
    switch (b?.action) {
      case "match": {
        const kind = b.kind as MatchKind;
        if (!(kind in MATCH_LABEL)) return NextResponse.json({ error: "Choose what this money is" }, { status: 400 });
        const fees = b.fees === undefined || b.fees === null || b.fees === "" ? null : Number(b.fees);
        line = await matchLine(
          tenant.id,
          session.userId,
          id,
          { kind, ref: str(b.ref), retailerId: str(b.retailerId), purpose: b.purpose === "WALLET" ? "WALLET" : "DUES", fees },
          str(b.note)
        );
        break;
      }
      case "unmatch":
        line = await unmatchLine(tenant.id, session.userId, id);
        break;
      case "ignore":
      case "unignore":
        line = await ignoreLine(tenant.id, session.userId, id, b.action === "ignore", str(b.note));
        break;
      default:
        return NextResponse.json({ error: "Action is match, unmatch, ignore or unignore" }, { status: 400 });
    }
    await audit(db, { actorId: session.userId, action: `bank.${b.action}`, entity: "BankLine", entityId: id, after: { kind: line.matchKind, ref: line.matchRef, status: line.status }, ip: requestIp(req) });
    return NextResponse.json(line);
  } catch (e) {
    return moneyFail(e);
  }
}
