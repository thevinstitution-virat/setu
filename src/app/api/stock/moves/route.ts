import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { parseRange } from "@/lib/money-api";
import type { StockMoveKind } from "@/generated/prisma/client";
import { MOVE_LABEL, reasonLabel } from "@/lib/inventory-settings";

/**
 * Stock history, newest first, 50 at a time. ?productId= ?locationId= ?kind=
 * ?from=&to= (YYYY-MM-DD, IST) ?tripId= ?orderId= ?before=<move id> (next page).
 */
export async function GET(req: Request) {
  const auth = await guard("stock.view");
  if (!auth.ok) return auth.res;
  const sp = new URL(req.url).searchParams;
  const kind = sp.get("kind");
  const locationId = sp.get("locationId");
  const range = parseRange(sp);
  const before = sp.get("before");
  const cursor = before ? await auth.db.stockMove.findUnique({ where: { id: before }, select: { createdAt: true } }) : null;
  const moves = await auth.db.stockMove.findMany({
    where: {
      ...(sp.get("productId") ? { productId: sp.get("productId")! } : {}),
      ...(kind && kind in MOVE_LABEL ? { kind: kind as StockMoveKind } : {}),
      ...(locationId ? { OR: [{ fromId: locationId }, { toId: locationId }] } : {}),
      ...(sp.get("tripId") ? { tripId: sp.get("tripId")! } : {}),
      ...(sp.get("orderId") ? { orderId: sp.get("orderId")! } : {}),
      ...(range || cursor ? { createdAt: { ...(range ? { gte: range.from, lte: range.to } : {}), ...(cursor ? { lt: cursor.createdAt } : {}) } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 51,
    include: { product: { select: { id: true, name: true, unit: true } }, lot: { select: { batch: true, expiry: true } } },
  });
  const page = moves.slice(0, 50);
  const placeIds = [...new Set(page.flatMap((m) => [m.fromId, m.toId]).filter(Boolean) as string[])];
  const userIds = [...new Set(page.map((m) => m.actorId).filter(Boolean) as string[])];
  const orderIds = [...new Set(page.map((m) => m.orderId).filter(Boolean) as string[])];
  const [places, users, orders] = await Promise.all([
    auth.db.stockLocation.findMany({ where: { id: { in: placeIds } }, select: { id: true, name: true } }),
    auth.db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
    auth.db.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, orderNumber: true } }),
  ]);
  const name = (id: string | null, list: { id: string; name: string }[]) => (id ? (list.find((x) => x.id === id)?.name ?? null) : null);
  return NextResponse.json({
    moves: page.map((m) => ({
      id: m.id,
      kind: m.kind,
      label: MOVE_LABEL[m.kind],
      product: m.product,
      qty: m.qty,
      from: name(m.fromId, places),
      to: name(m.toId, places),
      batch: m.lot?.batch ?? "",
      expiry: m.lot?.expiry ? m.lot.expiry.toISOString().slice(0, 10) : null,
      reason: m.reason,
      reasonLabel: reasonLabel(m.reason),
      note: m.note,
      orderId: m.orderId,
      orderNumber: orders.find((o) => o.id === m.orderId)?.orderNumber ?? null,
      tripId: m.tripId,
      purchaseId: m.purchaseId,
      by: name(m.actorId, users),
      at: m.createdAt,
    })),
    next: moves.length > 50 ? page[page.length - 1].id : null,
  });
}
