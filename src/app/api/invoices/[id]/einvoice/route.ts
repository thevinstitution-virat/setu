import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { cancelEInvoice, generateEInvoice } from "@/lib/einvoice";
import { moneyFail } from "@/lib/money-api";

/** Body: { action: "generate" } (get / retry the IRN) or { action: "cancel", reason } (within 24 hours). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard("invoices.manage");
  if (!auth.ok) return auth.res;
  const { db, session, tenant } = auth;
  const { id } = await params;
  const b = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const action = b.action ?? "generate";
  if (action !== "generate" && action !== "cancel") return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  const reason = typeof b.reason === "string" ? b.reason.trim().slice(0, 100) : "";
  if (action === "cancel" && !reason) return NextResponse.json({ error: "Give a reason" }, { status: 400 });
  const inv = await db.invoice.findUnique({ where: { id }, select: { id: true } });
  if (!inv) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let doc;
  try {
    doc = action === "generate" ? await generateEInvoice(tenant.id, id) : await cancelEInvoice(tenant.id, id, reason);
  } catch (e) {
    return moneyFail(e);
  }
  await audit(db, {
    actorId: session.userId,
    action: action === "generate" ? "invoice.einvoice" : "invoice.einvoice_cancel",
    entity: "Invoice",
    entityId: id,
    after: { irn: doc?.irn ?? null, status: doc?.einvStatus ?? null, reason: reason || undefined },
    ip: requestIp(req),
  });
  return NextResponse.json({ invoice: doc });
}
