import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { issueCreditNote, issueDebitNote, withMoney } from "@/lib/ledger";
import { moneyFail } from "@/lib/money-api";
import { queueEInvoice } from "@/lib/einvoice-queue";

/**
 * Issue a credit or debit note against a sale invoice.
 * Body: { type: "CREDIT_NOTE" | "DEBIT_NOTE", kind: "return" | "value" | "cancel", reason,
 *         lines: [{ lineId, quantity? (return), amount? (value, taxable paise) }] }
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard("invoices.manage");
  if (!auth.ok) return auth.res;
  const { db, session, tenant } = auth;
  const { id } = await params;
  const b = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const type = b.type;
  const kind = b.kind;
  if (type !== "CREDIT_NOTE" && type !== "DEBIT_NOTE") return NextResponse.json({ error: "Choose credit note or debit note" }, { status: 400 });
  if (kind !== "return" && kind !== "value" && kind !== "cancel") return NextResponse.json({ error: "Choose returned goods or a change in value" }, { status: 400 });
  const reason = typeof b.reason === "string" ? b.reason : "";
  const lines = (Array.isArray(b.lines) ? b.lines.slice(0, 300) : [])
    .filter((l): l is Record<string, unknown> => !!l && typeof l === "object" && typeof (l as Record<string, unknown>).lineId === "string")
    .map((l) => ({
      lineId: l.lineId as string,
      ...(l.quantity !== undefined ? { quantity: Number(l.quantity) } : {}),
      ...(l.amount !== undefined ? { amount: Number(l.amount) } : {}),
    }));

  let note;
  try {
    note = await withMoney(tenant.id, session.userId, (ctx) =>
      type === "CREDIT_NOTE"
        ? issueCreditNote(ctx, { invoiceId: id, kind, reason, lines })
        : issueDebitNote(ctx, { invoiceId: id, reason, lines })
    );
  } catch (e) {
    return moneyFail(e);
  }
  await audit(db, {
    actorId: session.userId,
    action: type === "CREDIT_NOTE" ? "invoice.credit_note" : "invoice.debit_note",
    entity: "Invoice",
    entityId: note.id,
    after: { number: note.number, original: id, kind, reason, total: note.total },
    ip: requestIp(req),
  });
  await queueEInvoice(tenant.id, note);
  return NextResponse.json({ note });
}
