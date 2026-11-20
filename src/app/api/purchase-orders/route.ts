import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import type { PoStatus } from "@/generated/prisma/client";
import { createPo, type PoLineInput } from "@/lib/stock";
import { optStr, str, stockMutation } from "@/lib/stock-api";

const STATUSES: PoStatus[] = ["DRAFT", "SENT", "PARTLY_RECEIVED", "RECEIVED", "CANCELLED"];

/** Purchase orders, newest first. ?status= ?supplierId= ?open=1 (draft, sent, partly received). */
export async function GET(req: Request) {
  const auth = await guard("stock.view");
  if (!auth.ok) return auth.res;
  const sp = new URL(req.url).searchParams;
  const status = sp.get("status") as PoStatus | null;
  const orders = await auth.db.purchaseOrder.findMany({
    where: {
      ...(status && STATUSES.includes(status) ? { status } : {}),
      ...(sp.get("open") === "1" ? { status: { in: ["DRAFT", "SENT", "PARTLY_RECEIVED"] } } : {}),
      ...(sp.get("supplierId") ? { supplierId: sp.get("supplierId")! } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { supplier: { select: { id: true, name: true } }, lines: { select: { quantity: true, receivedQty: true, unitCost: true } } },
  });
  return NextResponse.json({
    orders: orders.map(({ lines, ...o }) => ({
      ...o,
      lines: lines.length,
      units: lines.reduce((a, l) => a + l.quantity, 0),
      received: lines.reduce((a, l) => a + Math.min(l.receivedQty, l.quantity), 0),
      value: lines.reduce((a, l) => a + l.quantity * (l.unitCost ?? 0), 0),
    })),
  });
}

/** New draft purchase order. Body: { supplierId, expectedDate?, note?, lines: [{ productId, quantity, unitCost? }] } */
export async function POST(req: Request) {
  return stockMutation(
    req,
    "po.create",
    (ctx, b) =>
      createPo(ctx, {
        supplierId: str(b.supplierId),
        expectedDate: optStr(b.expectedDate, 10),
        note: optStr(b.note, 500),
        lines: (Array.isArray(b.lines) ? b.lines : []) as PoLineInput[],
      }),
    { entity: "PurchaseOrder", status: 201 }
  );
}
