import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { moneyFail } from "@/lib/money-api";
import { withMoney } from "@/lib/ledger";
import { readPeriod } from "@/lib/books";
import { fileResponse, purchaseRegisterCsv, purchaseRegisterSheet } from "@/lib/books-export";
import { purchaseRegister, recordPurchase, type PurchaseInput } from "@/lib/purchases";
import type { PurchaseDocType } from "@/generated/prisma/client";

const TYPES: PurchaseDocType[] = ["BILL", "DEBIT_NOTE", "CREDIT_NOTE"];

/** GET ?from=&to=&supplier=&type=&format=json|csv|pdf: the purchase register. */
export async function GET(req: Request) {
  const auth = await guard("accounts.view");
  if (!auth.ok) return auth.res;
  const sp = new URL(req.url).searchParams;
  const p = readPeriod(sp);
  if ("error" in p) return NextResponse.json({ error: p.error }, { status: 400 });
  const type = TYPES.find((t) => t === sp.get("type")) ?? null;
  const register = await withMoney(auth.tenant.id, auth.session.userId, (ctx) => purchaseRegister(ctx, p.from, p.to, { supplierId: sp.get("supplier"), type }));
  const format = sp.get("format");
  if (format === "csv" || format === "pdf") {
    await audit(auth.db, { actorId: auth.session.userId, action: "report.export", entity: "Report", entityId: "books:purchases", after: { format, ...p }, ip: requestIp(req) });
    return fileResponse(auth.db, auth.tenant.id, format, `purchase-register-${p.from}-to-${p.to}`, purchaseRegisterCsv(register), purchaseRegisterSheet(register));
  }
  return NextResponse.json({ register }, { headers: { "cache-control": "no-store" } });
}

/** POST PurchaseInput (paise): enter a purchase bill, a debit note to a supplier or a credit note from one. */
export async function POST(req: Request) {
  const auth = await guard("purchases.manage");
  if (!auth.ok) return auth.res;
  const body = (await req.json().catch(() => null)) as PurchaseInput | null;
  if (!body) return NextResponse.json({ error: "Nothing sent" }, { status: 400 });
  try {
    const doc = await withMoney(auth.tenant.id, auth.session.userId, (ctx) => recordPurchase(ctx, body));
    await audit(auth.db, { actorId: auth.session.userId, action: "purchase.create", entity: "PurchaseBill", entityId: doc.id, after: { number: doc.number, type: doc.type, supplierRef: doc.supplierRef, total: doc.total }, ip: requestIp(req) });
    return NextResponse.json({ doc }, { status: 201 });
  } catch (e) {
    return moneyFail(e);
  }
}
