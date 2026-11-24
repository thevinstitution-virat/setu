import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { moneyFail } from "@/lib/money-api";
import { withMoney } from "@/lib/ledger";
import { fileResponse } from "@/lib/books-export";
import { cancelVoucher, voucherDetail } from "@/lib/vouchers";
import { voucherCsv, voucherSheet } from "@/lib/vouchers-export";

type P = { params: Promise<{ id: string }> };

/** GET: one voucher. ?format=pdf|csv: the voucher to print and sign. */
export async function GET(req: Request, { params }: P) {
  const auth = await guard("accounts.view");
  if (!auth.ok) return auth.res;
  const { id } = await params;
  const format = new URL(req.url).searchParams.get("format");
  try {
    const voucher = await withMoney(auth.tenant.id, auth.session.userId, (ctx) => voucherDetail(ctx, id));
    if (format === "pdf" || format === "csv") {
      const t = await auth.db.tenant.findUniqueOrThrow({ where: { id: auth.tenant.id }, select: { name: true, legalName: true } });
      return fileResponse(auth.db, auth.tenant.id, format, `voucher-${voucher.number}`, voucherCsv(voucher), voucherSheet(voucher, { name: t.legalName || t.name }));
    }
    return NextResponse.json({ voucher }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return moneyFail(e);
  }
}

/** POST { action: "cancel", reason }: entered by mistake; its entry is reversed. */
export async function POST(req: Request, { params }: P) {
  const auth = await guard("accounts.post");
  if (!auth.ok) return auth.res;
  const { id } = await params;
  const b = ((await req.json().catch(() => null)) ?? {}) as { action?: string; reason?: string };
  if (b.action !== "cancel") return NextResponse.json({ error: "Action is cancel" }, { status: 400 });
  try {
    const v = await withMoney(auth.tenant.id, auth.session.userId, (ctx) => cancelVoucher(ctx, id, String(b.reason ?? "")));
    await audit(auth.db, { actorId: auth.session.userId, action: "voucher.cancel", entity: "Voucher", entityId: id, after: { number: v.number, reason: v.cancelReason }, ip: requestIp(req) });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return moneyFail(e);
  }
}
