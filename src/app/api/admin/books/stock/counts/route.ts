import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { moneyFail } from "@/lib/money-api";
import { withMoney } from "@/lib/ledger";
import { countList, startCount, type StartCountInput } from "@/lib/stock-counts";

/** GET: stock counts, newest first. */
export async function GET() {
  const auth = await guard("accounts.view");
  if (!auth.ok) return auth.res;
  try {
    const counts = await withMoney(auth.tenant.id, auth.session.userId, (ctx) => countList(ctx));
    return NextResponse.json({ counts }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return moneyFail(e);
  }
}

/** POST { date, locationId?, supplierId?, categoryId?, mode? (QUANTITY | VALUE when stock tracking is off), note? }: start a count sheet. */
export async function POST(req: Request) {
  const auth = await guard("accounts.post");
  if (!auth.ok) return auth.res;
  const b = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" && v ? v : null);
  try {
    const input: StartCountInput = {
      date: String(b.date ?? ""),
      mode: b.mode === "VALUE" ? "VALUE" : b.mode === "QUANTITY" ? "QUANTITY" : null,
      locationId: s(b.locationId),
      supplierId: s(b.supplierId),
      categoryId: s(b.categoryId),
      note: s(b.note),
    };
    const c = await withMoney(auth.tenant.id, auth.session.userId, (ctx) => startCount(ctx, input));
    await audit(auth.db, {
      actorId: auth.session.userId,
      action: "stockcount.start",
      entity: "StockCount",
      entityId: c.id,
      after: { number: c.number, date: input.date, mode: c.mode },
      ip: requestIp(req),
    });
    return NextResponse.json({ count: { id: c.id, number: c.number } }, { status: 201 });
  } catch (e) {
    return moneyFail(e);
  }
}
