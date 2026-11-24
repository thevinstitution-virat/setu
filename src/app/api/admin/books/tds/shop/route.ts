import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { moneyFail } from "@/lib/money-api";
import { withMoney } from "@/lib/ledger";
import { recordShopTds, setShopTdsCertificate } from "@/lib/tds";

/** POST { retailerId, amount, section?, date, certificate?, note? }: TDS a shop kept back from what it paid us. */
export async function POST(req: Request) {
  const auth = await guard("accounts.post");
  if (!auth.ok) return auth.res;
  const b = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const s = (k: string) => (typeof b[k] === "string" ? (b[k] as string) : "");
  try {
    const r = await withMoney(auth.tenant.id, auth.session.userId, (ctx) =>
      recordShopTds(ctx, { retailerId: s("retailerId"), amount: Number(b.amount), section: s("section") || null, date: s("date"), certificate: s("certificate") || null, note: s("note") || null }),
    );
    await audit(auth.db, { actorId: auth.session.userId, action: "tds.shop", entity: "Payment", entityId: r.id, after: r, ip: requestIp(req) });
    return NextResponse.json(r);
  } catch (e) {
    return moneyFail(e);
  }
}

/** PATCH { id, certificate }: the TDS certificate (Form 16A) for a shop's TDS has come. */
export async function PATCH(req: Request) {
  const auth = await guard("accounts.post");
  if (!auth.ok) return auth.res;
  const b = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  try {
    const r = await withMoney(auth.tenant.id, auth.session.userId, (ctx) => setShopTdsCertificate(ctx, String(b.id ?? ""), String(b.certificate ?? "")));
    await audit(auth.db, { actorId: auth.session.userId, action: "tds.shop.certificate", entity: "Payment", entityId: r.id, after: { reference: r.reference }, ip: requestIp(req) });
    return NextResponse.json({ id: r.id, certificate: r.reference });
  } catch (e) {
    return moneyFail(e);
  }
}
