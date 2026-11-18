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

export function generateOrderNumber() {
  const now = new Date();
  const datePart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
    now.getDate()
  ).padStart(2, "0")}`;
  const randPart = Math.floor(1000 + Math.random() * 9000);
  return `SU-${datePart}-${randPart}`;
}

export function nextStatus(current: OrderStatus): OrderStatus | null {
  const idx = ORDER_STATUS_FLOW.indexOf(current);
  if (idx === -1 || idx === ORDER_STATUS_FLOW.length - 1) return null;
  return ORDER_STATUS_FLOW[idx + 1];
}

export type PricedLine = { quantity: number; price: number; gstRate: number };

export function priceBreakup(lines: PricedLine[]) {
  const subtotal = lines.reduce((sum, l) => sum + l.price * l.quantity, 0);
  const gstAmount = lines.reduce((sum, l) => sum + (l.price * l.quantity * l.gstRate) / 100, 0);
  return { subtotal, gstAmount, totalAmount: subtotal + gstAmount };
}
