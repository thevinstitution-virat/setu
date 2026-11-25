import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { moneyFail } from "@/lib/money-api";
import { withMoney } from "@/lib/ledger";
import { openingSupplierBills, type OpeningSupplierBill } from "@/lib/purchases";

/** POST { asOf, bills: [{number, date, dueDate?, amount, paid?}], advance? } (paise): what we owed this supplier in the old books. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard("accounts.setup");
  if (!auth.ok) return auth.res;
  const { id } = await params;
  const b = ((await req.json().catch(() => null)) ?? {}) as { asOf?: string; bills?: OpeningSupplierBill[]; advance?: number };
  try {
    const result = await withMoney(auth.tenant.id, auth.session.userId, (ctx) => openingSupplierBills(ctx, id, Array.isArray(b.bills) ? b.bills.slice(0, 1000) : [], Number(b.advance ?? 0), b.asOf));
    await audit(auth.db, { actorId: auth.session.userId, action: "books.supplier.opening", entity: "Supplier", entityId: id, after: result, ip: requestIp(req) });
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return moneyFail(e);
  }
}
