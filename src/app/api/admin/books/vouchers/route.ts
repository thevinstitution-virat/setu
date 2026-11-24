import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { moneyFail } from "@/lib/money-api";
import { withMoney } from "@/lib/ledger";
import { readPeriod } from "@/lib/books";
import { fileResponse } from "@/lib/books-export";
import { createVoucher, voucherList, voucherOptions, type VoucherInput } from "@/lib/vouchers";
import { voucherListCsv, voucherListSheet } from "@/lib/vouchers-export";
import { isVoucherType } from "@/lib/voucher-labels";

/**
 * GET ?from=&to=&type=&q=[&format=pdf|csv]: vouchers in a period.
 * GET ?options=1: heads, cash, banks and staff for the voucher forms.
 */
export async function GET(req: Request) {
  const auth = await guard("accounts.view");
  if (!auth.ok) return auth.res;
  const sp = new URL(req.url).searchParams;
  try {
    if (sp.get("options") === "1") {
      const options = await withMoney(auth.tenant.id, auth.session.userId, (ctx) => voucherOptions(ctx));
      return NextResponse.json(options, { headers: { "cache-control": "no-store" } });
    }
    const period = readPeriod(sp);
    if ("error" in period) return NextResponse.json({ error: period.error }, { status: 400 });
    const t = sp.get("type");
    const list = await withMoney(auth.tenant.id, auth.session.userId, (ctx) => voucherList(ctx, period.from, period.to, { type: isVoucherType(t) ? t : null, q: sp.get("q") }));
    const format = sp.get("format");
    if (format === "pdf" || format === "csv") return fileResponse(auth.db, auth.tenant.id, format, `vouchers-${period.from}-${period.to}`, voucherListCsv(list), voucherListSheet(list));
    return NextResponse.json(list, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return moneyFail(e);
  }
}

/** POST VoucherInput (paise): enter a payment, receipt, contra or journal voucher. */
export async function POST(req: Request) {
  const auth = await guard("accounts.post");
  if (!auth.ok) return auth.res;
  const body = (await req.json().catch(() => null)) as VoucherInput | null;
  if (!body) return NextResponse.json({ error: "Nothing sent" }, { status: 400 });
  try {
    const v = await withMoney(auth.tenant.id, auth.session.userId, (ctx) => createVoucher(ctx, body));
    await audit(auth.db, {
      actorId: auth.session.userId,
      action: "voucher.create",
      entity: "Voucher",
      entityId: v.id,
      after: { number: v.number, type: v.type, amount: v.amount, method: v.method },
      ip: requestIp(req),
    });
    return NextResponse.json({ voucher: v }, { status: 201 });
  } catch (e) {
    return moneyFail(e);
  }
}
