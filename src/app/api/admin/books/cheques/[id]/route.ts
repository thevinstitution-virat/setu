import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { moneyFail } from "@/lib/money-api";
import { withMoney } from "@/lib/ledger";
import { todayIst } from "@/lib/books";
import { clearIssuedCheque } from "@/lib/supplier-payments";

/** POST { action: "clear", date? }: our bank paid this cheque. (Bounced / stopped: cancel its payment.) */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard("payables.pay");
  if (!auth.ok) return auth.res;
  const { id } = await params;
  const b = ((await req.json().catch(() => null)) ?? {}) as {
    action?: string;
    date?: string;
  };
  if (b.action !== "clear") return NextResponse.json({ error: "Action is clear" }, { status: 400 });
  try {
    const ch = await withMoney(auth.tenant.id, auth.session.userId, (ctx) => clearIssuedCheque(ctx, id, b.date || todayIst()));
    await audit(auth.db, {
      actorId: auth.session.userId,
      action: "cheque.issued.clear",
      entity: "IssuedCheque",
      entityId: id,
      after: { number: ch.number, date: b.date ?? null },
      ip: requestIp(req),
    });
    return NextResponse.json({ cheque: ch });
  } catch (e) {
    return moneyFail(e);
  }
}
