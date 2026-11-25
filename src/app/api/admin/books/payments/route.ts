import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { moneyFail } from "@/lib/money-api";
import { withMoney } from "@/lib/ledger";
import { readPeriod } from "@/lib/books";
import { paySupplier, paymentsList, PAY_METHOD_LABEL, type PayInput } from "@/lib/supplier-payments";
import type { SupplierPayMethod } from "@/generated/prisma/client";

/** GET ?from=&to=&supplier=&method=: payments to suppliers in a period. */
export async function GET(req: Request) {
  const auth = await guard("accounts.view");
  if (!auth.ok) return auth.res;
  const sp = new URL(req.url).searchParams;
  const p = readPeriod(sp);
  if ("error" in p) return NextResponse.json({ error: p.error }, { status: 400 });
  const m = sp.get("method");
  const method = m && m in PAY_METHOD_LABEL ? (m as SupplierPayMethod) : null;
  const list = await withMoney(auth.tenant.id, auth.session.userId, (ctx) => paymentsList(ctx, p.from, p.to, { supplierId: sp.get("supplier"), method }));
  return NextResponse.json(list, { headers: { "cache-control": "no-store" } });
}

/** POST PayInput (paise): pay a supplier by bank, cash or our cheque. */
export async function POST(req: Request) {
  const auth = await guard("payables.pay");
  if (!auth.ok) return auth.res;
  const body = (await req.json().catch(() => null)) as PayInput | null;
  if (!body) return NextResponse.json({ error: "Nothing sent" }, { status: 400 });
  try {
    const p = await withMoney(auth.tenant.id, auth.session.userId, (ctx) => paySupplier(ctx, body));
    await audit(auth.db, {
      actorId: auth.session.userId,
      action: "supplier.pay",
      entity: "SupplierPayment",
      entityId: p.id,
      after: {
        number: p.number,
        supplier: p.supplier.name,
        method: p.method,
        amount: p.amount,
        tds: p.tds,
        cheque: p.cheque?.number ?? null,
      },
      ip: requestIp(req),
    });
    return NextResponse.json({ payment: p }, { status: 201 });
  } catch (e) {
    return moneyFail(e);
  }
}
