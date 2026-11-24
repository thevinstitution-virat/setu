import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { moneyFail } from "@/lib/money-api";
import { withMoney } from "@/lib/ledger";
import { setBooksLock } from "@/lib/books";

/** POST {until: "YYYY-MM-DD" | null}: close the books up to a day. Opening closed days is the owner's. */
export async function POST(req: Request) {
  const auth = await guard("accounts.lock");
  if (!auth.ok) return auth.res;
  const body = (await req.json().catch(() => null)) as { until?: unknown } | null;
  const until = body?.until === null || body?.until === "" ? null : typeof body?.until === "string" ? body.until : undefined;
  if (until === undefined) return NextResponse.json({ error: "Pick a date" }, { status: 400 });
  try {
    const me = await auth.db.user.findUnique({ where: { id: auth.session.userId }, select: { isOwner: true } });
    const out = await withMoney(auth.tenant.id, auth.session.userId, (ctx) => setBooksLock(ctx, until, !!me?.isOwner));
    await audit(auth.db, { actorId: auth.session.userId, action: "books.lock", entity: "Tenant", entityId: auth.tenant.id, before: { lockedUntil: out.before }, after: { lockedUntil: out.after }, ip: requestIp(req) });
    return NextResponse.json({ lockedUntil: out.after });
  } catch (e) {
    return moneyFail(e);
  }
}
