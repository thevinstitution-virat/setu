import { NextResponse } from "next/server";
import type { InvoiceType } from "@/generated/prisma/client";
import { guard } from "@/lib/guard";
import { withTenantTx } from "@/lib/db";
import { audit, requestIp } from "@/lib/audit";
import { MoneyError } from "@/lib/money-error";
import { invoiceSettings } from "@/lib/invoice-settings";
import { runningNumber } from "@/lib/gst";
import { nextRunningNumber, prefixFor, setNextRunningNumber } from "@/lib/invoice";

const TYPES: InvoiceType[] = ["TAX_INVOICE", "BILL_OF_SUPPLY", "CREDIT_NOTE", "DEBIT_NOTE"];

/** Next number of each document type in the running series, with how it will print. */
export async function GET() {
  const auth = await guard("settings.manage");
  if (!auth.ok) return auth.res;
  const s = invoiceSettings(auth.tenant.settings);
  const next = await withTenantTx(auth.tenant.id, async (tx) =>
    Promise.all(TYPES.map(async (type) => [type, await nextRunningNumber(tx, auth.tenant.id, type)] as const))
  );
  return NextResponse.json({
    style: s.numbering.style,
    next: Object.fromEntries(next.map(([type, n]) => [type, { next: n, printed: runningNumber(prefixFor(s, type), n, s.numbering.digits) }])),
  });
}

/**
 * Body: { type, next } — carry on the old book's series (last bill A004261 → next 4262).
 * Only moves forward, so no number is ever issued twice.
 */
export async function POST(req: Request) {
  const auth = await guard("settings.manage");
  if (!auth.ok) return auth.res;
  const body = await req.json().catch(() => null);
  const type = body?.type as InvoiceType;
  if (!TYPES.includes(type)) return NextResponse.json({ error: "Choose a document type" }, { status: 400 });
  const s = invoiceSettings(auth.tenant.settings);
  try {
    const result = await withTenantTx(auth.tenant.id, async (tx) => {
      const before = await nextRunningNumber(tx, auth.tenant.id, type);
      const next = await setNextRunningNumber(tx, auth.tenant.id, type, Number(body?.next));
      // Keep within GST's 16 characters with this prefix and width.
      const printed = runningNumber(prefixFor(s, type), next, s.numbering.digits);
      return { before, next, printed };
    });
    await audit(auth.db, {
      actorId: auth.session.userId,
      action: "settings.numbering",
      entity: "Tenant",
      entityId: auth.tenant.id,
      before: { type, next: result.before },
      after: { type, next: result.next },
      ip: requestIp(req),
    });
    return NextResponse.json({ type, next: result.next, printed: result.printed });
  } catch (e) {
    if (e instanceof MoneyError) return NextResponse.json({ error: e.message }, { status: e.status ?? 400 });
    if (e instanceof Error && /16 characters/.test(e.message)) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
