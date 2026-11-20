"use client";

/**
 * Shared bits for online payment requests (links and QRs) on the retailer,
 * delivery and sales screens: the API JSON types, status chip and fetch helpers.
 */

export type PayStatus = "CREATED" | "PARTIAL" | "PAID" | "EXPIRED" | "CANCELLED";

export type PayRequest = {
  id: string;
  kind: "LINK" | "QR";
  provider: string;
  retailerId: string;
  outletName: string | null;
  purpose: "DUES" | "WALLET";
  amount: number;
  paidAmount: number;
  orderId: string | null;
  shortUrl: string | null;
  imageUrl: string | null;
  status: PayStatus;
  error: string | null;
  note: string | null;
  expiresAt: string;
  createdAt: string;
};

export type PayList = {
  /** The business has a gateway set up. */
  on: boolean;
  provider: "none" | "razorpay" | "simulator";
  /** Shops may pay online themselves. */
  retailerPay: boolean;
  requests: PayRequest[];
};

/** Past its time (the server may not have marked it yet). */
export const isExpired = (r: Pick<PayRequest, "expiresAt">) => new Date(r.expiresAt).getTime() <= Date.now();

/** Still waiting for (more) money. */
export const isOpen = (r: Pick<PayRequest, "status" | "expiresAt">) => (r.status === "CREATED" || r.status === "PARTIAL") && !isExpired(r);

export const leftOf = (r: Pick<PayRequest, "amount" | "paidAmount">) => Math.max(0, r.amount - r.paidAmount);

export const timeOf = (s: string) => new Date(s).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
export const dayOf = (s: string) => new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

export function PayStatusChip({ r }: { r: Pick<PayRequest, "status" | "expiresAt"> }) {
  if (r.status === "PAID") return <span className="chip chip-mint">Paid</span>;
  if (r.status === "PARTIAL") return <span className="chip chip-kesar">Part paid</span>;
  if (r.status === "CANCELLED") return <span className="chip">Cancelled</span>;
  if (r.status === "EXPIRED" || isExpired(r)) return <span className="chip">Expired</span>;
  return <span className="chip chip-genda">Waiting</span>;
}

async function json<T>(res: Response, fallback: string): Promise<T> {
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((d as { error?: string }).error ?? fallback);
  return d as T;
}

export async function listPayRequests(query: Record<string, string> = {}) {
  const q = new URLSearchParams(query).toString();
  return json<PayList>(await fetch(`/api/pay-requests${q ? `?${q}` : ""}`), "Could not load online payments");
}

export async function createPayRequest(body: { kind: "LINK" | "QR"; retailerId?: string; amount?: number; orderId?: string; purpose?: "DUES" | "WALLET"; note?: string }) {
  return json<PayRequest>(
    await fetch("/api/pay-requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    "Could not make the payment request"
  );
}

/** One request; sync asks the gateway too (use it when polling). */
export async function getPayRequest(id: string, sync = false) {
  return json<PayRequest>(await fetch(`/api/pay-requests/${id}${sync ? "?sync=1" : ""}`), "Could not check the payment");
}

export async function cancelPayRequest(id: string) {
  return json<PayRequest>(
    await fetch(`/api/pay-requests/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel" }) }),
    "Could not cancel"
  );
}
