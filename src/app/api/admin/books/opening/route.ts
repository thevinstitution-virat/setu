import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { moneyFail } from "@/lib/money-api";
import { withMoney } from "@/lib/ledger";
import { openingView, saveOpening } from "@/lib/final-accounts";

/** GET: the opening trial balance. POST { startOn, openingStock (paise | null), lines: [{ code, amount (paise, debit +) }] }: save it. */
export async function GET() {
  const auth = await guard("accounts.view");
  if (!auth.ok) return auth.res;
  try {
    return NextResponse.json(await withMoney(auth.tenant.id, auth.session.userId, (ctx) => openingView(ctx)), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return moneyFail(e);
  }
}

export async function POST(req: Request) {
  const auth = await guard("accounts.setup");
  if (!auth.ok) return auth.res;
  const b = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const lines = (Array.isArray(b.lines) ? b.lines : []) as Record<string, unknown>[];
  const stock = b.openingStock === null || b.openingStock === undefined || b.openingStock === "" ? null : Number(b.openingStock);
  try {
    const view = await withMoney(auth.tenant.id, auth.session.userId, (ctx) =>
      saveOpening(ctx, { startOn: String(b.startOn ?? ""), openingStock: stock, lines: lines.map((l) => ({ code: String(l.code ?? ""), amount: Number(l.amount) })) }),
    );
    await audit(auth.db, {
      actorId: auth.session.userId,
      action: "books.opening",
      entity: "Tenant",
      entityId: auth.tenant.id,
      after: { startOn: view.startOn, openingStock: view.openingStock, lines: view.accounts.filter((a) => a.amount).length, difference: view.difference },
      ip: requestIp(req),
    });
    return NextResponse.json(view);
  } catch (e) {
    return moneyFail(e);
  }
}
