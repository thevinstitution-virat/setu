import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";

/** One goods receipt with its lines. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard("stock.view");
  if (!auth.ok) return auth.res;
  const { id } = await params;
  const purchase = await auth.db.purchase.findUnique({
    where: { id },
    include: {
      supplier: true,
      location: { select: { id: true, name: true } },
      po: { select: { id: true, number: true } },
      bill: { select: { id: true, number: true, cancelledAt: true } },
      lines: { include: { product: { select: { id: true, name: true, sku: true, unit: true } } } },
    },
  });
  if (!purchase) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const by = purchase.createdById ? await auth.db.user.findUnique({ where: { id: purchase.createdById }, select: { name: true } }) : null;
  return NextResponse.json({ purchase: { ...purchase, createdBy: by?.name ?? null } });
}
