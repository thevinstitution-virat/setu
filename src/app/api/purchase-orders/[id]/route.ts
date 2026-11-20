import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { setPoStatus, updatePo, type PoLineInput } from "@/lib/stock";
import { stockMutation } from "@/lib/stock-api";

/** One purchase order with lines, goods received against it, and the business details for printing. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard("stock.view");
  if (!auth.ok) return auth.res;
  const { id } = await params;
  const po = await auth.db.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: true,
      lines: { include: { product: { select: { id: true, name: true, sku: true, unit: true, caseUnit: true, caseSize: true, hsnCode: true } } } },
      receipts: { select: { id: true, number: true, createdAt: true, billNo: true, total: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!po) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const business = await auth.db.tenant.findUniqueOrThrow({ where: { id: auth.tenant.id }, select: { name: true, legalName: true, gstin: true, address: true, phone: true } });
  return NextResponse.json({ po, business });
}

/**
 * Body: { status: "SENT" | "CANCELLED" } to mark it sent / cancel it, or
 * { expectedDate?, note?, lines? } to edit a draft (lines replace all lines).
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return stockMutation(
    req,
    "po.update",
    async (ctx, b) => {
      if (b.status === "SENT" || b.status === "CANCELLED") return setPoStatus(ctx, id, b.status);
      return updatePo(ctx, id, {
        ...(b.expectedDate !== undefined ? { expectedDate: (b.expectedDate as string | null) || null } : {}),
        ...(b.note !== undefined ? { note: (b.note as string | null) || null } : {}),
        ...(Array.isArray(b.lines) ? { lines: b.lines as PoLineInput[] } : {}),
      });
    },
    { entity: "PurchaseOrder", entityId: id }
  );
}
