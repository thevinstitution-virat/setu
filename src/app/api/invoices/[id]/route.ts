import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { can } from "@/lib/permissions";
import { loadInvoiceDoc } from "@/lib/invoice";
import { einvoiceProblems } from "@/lib/einvoice";
import { canSeeInvoice, originOf, shareInfo } from "@/lib/invoice-api";

/** One document with its lines, notes, share links and what this user may do with it. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard();
  if (!auth.ok) return auth.res;
  const { db, session, tenant } = auth;
  const { id } = await params;
  const doc = await loadInvoiceDoc(db as never, id);
  if (!doc || !(await canSeeInvoice(db, session, doc))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const manage = can(session.role, "invoices.manage");
  const sale = doc.type === "TAX_INVOICE" || doc.type === "BILL_OF_SUPPLY";
  return NextResponse.json({
    invoice: doc,
    share: shareInfo(originOf(req), tenant.id, doc),
    einvoiceProblems: doc.einvStatus === "PENDING" || doc.einvStatus === "FAILED" ? einvoiceProblems(doc) : [],
    can: {
      creditNote: manage && sale,
      debitNote: manage && sale,
      einvoice: manage && (doc.einvStatus === "PENDING" || doc.einvStatus === "FAILED"),
      cancelEinvoice: manage && doc.einvStatus === "GENERATED" && !!doc.ackDate && Date.now() - doc.ackDate.getTime() < 86_400_000,
      eway: manage && sale && !doc.ewbNo,
    },
  });
}
