import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { moneyFail } from "@/lib/money-api";
import { withMoney } from "@/lib/ledger";
import { settleGst } from "@/lib/gst-returns";

/** POST { period, opening?: { igst, cgst, sgst } (paise; first month only), bankAccountId?, challan?, paidOn, arn? }: settle a month's GST. */
export async function POST(req: Request) {
  const auth = await guard("accounts.post");
  if (!auth.ok) return auth.res;
  const b = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const o = b.opening && typeof b.opening === "object" ? (b.opening as Record<string, unknown>) : null;
  try {
    const r = await withMoney(auth.tenant.id, auth.session.userId, (ctx) =>
      settleGst(ctx, {
        period: String(b.period ?? ""),
        opening: o ? { igst: Number(o.igst ?? 0), cgst: Number(o.cgst ?? 0), sgst: Number(o.sgst ?? 0) } : null,
        bankAccountId: typeof b.bankAccountId === "string" && b.bankAccountId ? b.bankAccountId : null,
        challan: typeof b.challan === "string" ? b.challan : null,
        paidOn: String(b.paidOn ?? ""),
        arn: typeof b.arn === "string" ? b.arn : null,
      }),
    );
    await audit(auth.db, { actorId: auth.session.userId, action: "gst.settle", entity: "GstSettlement", entityId: r.id, after: r, ip: requestIp(req) });
    return NextResponse.json(r);
  } catch (e) {
    return moneyFail(e);
  }
}
