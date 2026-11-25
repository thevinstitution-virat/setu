import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { moneyFail } from "@/lib/money-api";
import { withMoney } from "@/lib/ledger";
import { setDefaultBank, updateBank } from "@/lib/books";

/**
 * PATCH {name?, kind?, bankName?, last4?, ifsc?, branch?, odLimit?, active?}
 * or {makeDefault: true}. Closing refuses the default bank and one with money in the books.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard("accounts.setup");
  if (!auth.ok) return auth.res;
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
  try {
    if (body.makeDefault === true) {
      const bank = await withMoney(auth.tenant.id, auth.session.userId, (ctx) => setDefaultBank(ctx, id));
      await audit(auth.db, { actorId: auth.session.userId, action: "books.bank.default", entity: "BankAccount", entityId: id, after: { isDefault: true }, ip: requestIp(req) });
      return NextResponse.json({ bank });
    }
    const { before, after } = await withMoney(auth.tenant.id, auth.session.userId, (ctx) => updateBank(ctx, id, body));
    await audit(auth.db, { actorId: auth.session.userId, action: "books.bank.update", entity: "BankAccount", entityId: id, before, after, ip: requestIp(req) });
    return NextResponse.json({ bank: after });
  } catch (e) {
    return moneyFail(e);
  }
}
