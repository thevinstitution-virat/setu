import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { moneyFail } from "@/lib/money-api";
import { withMoney } from "@/lib/ledger";
import { cancelBillTds, deductOnBill } from "@/lib/tds";

/** POST { purchaseBillId, section, base, tds, date?, note? }: keep back TDS on a supplier's bill. */
export async function POST(req: Request) {
  const auth = await guard("accounts.post");
  if (!auth.ok) return auth.res;
  const b = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  try {
    const r = await withMoney(auth.tenant.id, auth.session.userId, (ctx) =>
      deductOnBill(ctx, {
        purchaseBillId: String(b.purchaseBillId ?? ""),
        section: String(b.section ?? ""),
        base: Number(b.base),
        tds: Number(b.tds),
        date: typeof b.date === "string" ? b.date : null,
        note: typeof b.note === "string" ? b.note : null,
      }),
    );
    await audit(auth.db, { actorId: auth.session.userId, action: "tds.bill", entity: "SupplierCredit", entityId: r.id, after: r, ip: requestIp(req) });
    return NextResponse.json(r);
  } catch (e) {
    return moneyFail(e);
  }
}

/** DELETE ?id&reason: undo TDS kept back on a bill. */
export async function DELETE(req: Request) {
  const auth = await guard("accounts.post");
  if (!auth.ok) return auth.res;
  const sp = new URL(req.url).searchParams;
  try {
    const r = await withMoney(auth.tenant.id, auth.session.userId, (ctx) => cancelBillTds(ctx, sp.get("id") ?? "", sp.get("reason") ?? ""));
    await audit(auth.db, { actorId: auth.session.userId, action: "tds.bill.cancel", entity: "SupplierCredit", entityId: r.id, after: { ...r, reason: sp.get("reason") }, ip: requestIp(req) });
    return NextResponse.json(r);
  } catch (e) {
    return moneyFail(e);
  }
}
