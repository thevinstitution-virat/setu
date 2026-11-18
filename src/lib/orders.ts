import type { OrderStatus } from "@/generated/prisma/client";

export const ORDER_STATUS_FLOW: OrderStatus[] = [
  "PLACED",
  "CONFIRMED",
  "PACKED",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
];

export const STATUS_LABEL: Record<OrderStatus, string> = {
  PLACED: "Order placed",
  CONFIRMED: "Confirmed",
  PACKED: "Packed",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
};

export const STATUS_COLOR: Record<OrderStatus, string> = {
  PLACED: "st st-placed",
  CONFIRMED: "st st-confirmed",
  PACKED: "st st-packed",
  OUT_FOR_DELIVERY: "st st-out",
  DELIVERED: "st st-delivered",
  CANCELLED: "st st-cancelled",
};

/** Tinted background for a stage tile on the admin pipeline. */
export const STATUS_TILE: Record<OrderStatus, string> = {
  PLACED: "tile-placed",
  CONFIRMED: "tile-confirmed",
  PACKED: "tile-packed",
  OUT_FOR_DELIVERY: "tile-out",
  DELIVERED: "tile-delivered",
  CANCELLED: "",
};

/** Indian financial year label for a date: 19 Nov 2026 → "2627" (FY 2026-27). */
export function fyLabel(d = new Date()): string {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${String(y % 100).padStart(2, "0")}${String((y + 1) % 100).padStart(2, "0")}`;
}

export function formatOrderNumber(fy: string, seq: number) {
  return `SO-${fy}-${String(seq).padStart(6, "0")}`;
}

type CounterDb = {
  counter: {
    upsert(args: {
      where: { tenantId_key: { tenantId: string; key: string } };
      create: { tenantId: string; key: string; value: number };
      update: { value: { increment: number } };
    }): Promise<{ value: number }>;
  };
};

/** Next gap-free number in a per-tenant series (atomic upsert). */
export async function nextSequence(db: CounterDb, tenantId: string, key: string) {
  const row = await db.counter.upsert({
    where: { tenantId_key: { tenantId, key } },
    create: { tenantId, key, value: 1 },
    update: { value: { increment: 1 } },
  });
  return row.value;
}

/** e.g. SO-2627-000042, numbered per tenant per financial year. */
export async function nextOrderNumber(db: CounterDb, tenantId: string, now = new Date()) {
  const fy = fyLabel(now);
  return formatOrderNumber(fy, await nextSequence(db, tenantId, `order:${fy}`));
}

export function nextStatus(current: OrderStatus): OrderStatus | null {
  const idx = ORDER_STATUS_FLOW.indexOf(current);
  if (idx === -1 || idx === ORDER_STATUS_FLOW.length - 1) return null;
  return ORDER_STATUS_FLOW[idx + 1];
}

/** price is paise per unit before GST; result is in paise. */
export type PricedLine = { quantity: number; price: number; gstRate: number };

export function priceBreakup(lines: PricedLine[]) {
  let subtotal = 0;
  let gstAmount = 0;
  for (const l of lines) {
    const amount = l.price * l.quantity;
    subtotal += amount;
    gstAmount += Math.round((amount * l.gstRate) / 100);
  }
  return { subtotal, gstAmount, totalAmount: subtotal + gstAmount };
}
