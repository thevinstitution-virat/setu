import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { moneyFail } from "@/lib/money-api";
import { withMoney } from "@/lib/ledger";
import { cancelTdsChallan, payTdsChallan } from "@/lib/tds";

/** POST { section, period, tax, interest?, lateFee?, bankAccountId?, paidOn, bsrCode, serial, note? }: a TDS challan paid. */
export async function POST(req: Request) {
  const auth = await guard("accounts.post");
  if (!auth.ok) return auth.res;
  const b = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const s = (k: string) => (typeof b[k] === "string" ? (b[k] as string) : "");
  try {
    const r = await withMoney(auth.tenant.id, auth.session.userId, (ctx) =>
      payTdsChallan(ctx, {
        section: s("section"),
        period: s("period"),
        tax: Number(b.tax ?? 0),
        interest: Number(b.interest ?? 0),
        lateFee: Number(b.lateFee ?? 0),
        bankAccountId: s("bankAccountId") || null,
        paidOn: s("paidOn"),
        bsrCode: s("bsrCode"),
        serial: s("serial"),
        note: s("note") || null,
      }),
    );
    await audit(auth.db, { actorId: auth.session.userId, action: "tds.challan", entity: "TdsChallan", entityId: r.id, after: r, ip: requestIp(req) });
    return NextResponse.json(r);
  } catch (e) {
    return moneyFail(e);
  }
}

/** DELETE ?id&reason: cancel a challan entered by mistake (reversed today). */
export async function DELETE(req: Request) {
  const auth = await guard("accounts.post");
  if (!auth.ok) return auth.res;
  const sp = new URL(req.url).searchParams;
  try {
    const r = await withMoney(auth.tenant.id, auth.session.userId, (ctx) => cancelTdsChallan(ctx, sp.get("id") ?? "", sp.get("reason") ?? ""));
    await audit(auth.db, { actorId: auth.session.userId, action: "tds.challan.cancel", entity: "TdsChallan", entityId: r.id, after: { ...r, reason: sp.get("reason") }, ip: requestIp(req) });
    return NextResponse.json(r);
  } catch (e) {
    return moneyFail(e);
  }
}
