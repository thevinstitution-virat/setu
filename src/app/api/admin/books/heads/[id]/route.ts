import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { moneyFail } from "@/lib/money-api";
import { withMoney } from "@/lib/ledger";
import { updateHead } from "@/lib/books";

/** PATCH {name?, group?, active?, note?}: rename, move, hide or show a head. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard("accounts.setup");
  if (!auth.ok) return auth.res;
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
  try {
    const { before, after } = await withMoney(auth.tenant.id, auth.session.userId, (ctx) =>
      updateHead(ctx, id, { name: body.name, group: body.group, active: body.active, note: body.note })
    );
    await audit(auth.db, { actorId: auth.session.userId, action: "books.head.update", entity: "LedgerHead", entityId: id, before, after, ip: requestIp(req) });
    return NextResponse.json({ head: after });
  } catch (e) {
    return moneyFail(e);
  }
}
