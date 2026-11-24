import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { moneyFail } from "@/lib/money-api";
import { withMoney } from "@/lib/ledger";
import { createHead, ensureBooks } from "@/lib/books";

/** GET: the business's account heads. POST {name, group, note}: add one. */
export async function GET() {
  const auth = await guard("accounts.view");
  if (!auth.ok) return auth.res;
  const heads = await withMoney(auth.tenant.id, auth.session.userId, async (ctx) => {
    await ensureBooks(ctx);
    return ctx.tx.ledgerHead.findMany({ orderBy: [{ group: "asc" }, { name: "asc" }] });
  });
  return NextResponse.json({ heads });
}

export async function POST(req: Request) {
  const auth = await guard("accounts.setup");
  if (!auth.ok) return auth.res;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  try {
    const head = await withMoney(auth.tenant.id, auth.session.userId, async (ctx) => {
      await ensureBooks(ctx);
      return createHead(ctx, { name: body?.name, group: body?.group, note: body?.note });
    });
    await audit(auth.db, { actorId: auth.session.userId, action: "books.head.create", entity: "LedgerHead", entityId: head.id, after: head, ip: requestIp(req) });
    return NextResponse.json({ head }, { status: 201 });
  } catch (e) {
    return moneyFail(e);
  }
}
