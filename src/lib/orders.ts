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
  PLACED: "bg-amber-100 text-amber-800",
  CONFIRMED: "bg-blue-100 text-blue-800",
  PACKED: "bg-indigo-100 text-indigo-800",
  OUT_FOR_DELIVERY: "bg-purple-100 text-purple-800",
  DELIVERED: "bg-emerald-100 text-emerald-800",
  CANCELLED: "bg-red-100 text-red-800",
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
