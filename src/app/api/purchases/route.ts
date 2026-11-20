import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { receiveGoods, type ReceiveLine } from "@/lib/stock";
import { optStr, str, stockMutation } from "@/lib/stock-api";

/** Goods received (GRNs), newest first. ?supplierId= */
export async function GET(req: Request) {
  const auth = await guard("stock.view");
  if (!auth.ok) return auth.res;
  const supplierId = new URL(req.url).searchParams.get("supplierId");
  const purchases = await auth.db.purchase.findMany({
    where: supplierId ? { supplierId } : {},
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      supplier: { select: { id: true, name: true } },
      location: { select: { name: true } },
      po: { select: { id: true, number: true } },
      _count: { select: { lines: true } },
    },
  });
  return NextResponse.json({ purchases });
}

/**
 * Receive goods. Body: { supplierId, locationId? (default: loading warehouse), poId?,
 * billNo?, billDate? (YYYY-MM-DD), note?, lines: [{ productId, quantity (base units),
 * batch?, expiry? (YYYY-MM-DD), mfgDate?, unitCost? (paise before GST) }] }
 */
export async function POST(req: Request) {
  return stockMutation(
    req,
    "stock.receive",
    (ctx, b) =>
      receiveGoods(ctx, {
        supplierId: str(b.supplierId),
        locationId: optStr(b.locationId),
        poId: optStr(b.poId),
        billNo: optStr(b.billNo, 40),
        billDate: optStr(b.billDate, 10),
        note: optStr(b.note, 300),
        lines: (Array.isArray(b.lines) ? b.lines : []).map((l: Record<string, unknown>) => ({
          productId: String(l?.productId ?? ""),
          quantity: Number(l?.quantity),
          batch: typeof l?.batch === "string" ? l.batch : null,
          expiry: typeof l?.expiry === "string" ? l.expiry : null,
          mfgDate: typeof l?.mfgDate === "string" ? l.mfgDate : null,
          unitCost: l?.unitCost === undefined || l?.unitCost === null || l?.unitCost === "" ? null : Number(l.unitCost),
        })) as ReceiveLine[],
      }),
    { entity: "Purchase", status: 201 }
  );
}
