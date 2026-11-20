import { createHmac } from "node:crypto";
import { sameText } from "@/lib/secrets";

/**
 * Razorpay over plain HTTPS (no SDK): payment links, single-use UPI QR codes,
 * and the webhook signature check. Amounts are paise; times are unix seconds.
 * Docs: Payment Links API, QR Codes API, Webhooks (X-Razorpay-Signature =
 * HMAC-SHA256 of the raw body with the webhook secret).
 */

const BASE = "https://api.razorpay.com/v1";

export type RzpKeys = { keyId: string; keySecret: string };

export class RazorpayError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

async function call<T>(keys: RzpKeys, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${keys.keyId}:${keys.keySecret}`).toString("base64")}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: { description?: string; code?: string } };
  if (!res.ok) throw new RazorpayError(data.error?.description ?? `Razorpay said ${res.status}`, res.status);
  return data;
}

export type RzpPayment = {
  id: string;
  amount: number;
  status: string;
  method?: string;
  vpa?: string | null;
  email?: string | null;
  contact?: string | null;
  created_at?: number;
  acquirer_data?: { rrn?: string | null; upi_transaction_id?: string | null; bank_transaction_id?: string | null } | null;
  notes?: Record<string, string> | unknown[];
};

export type RzpLink = {
  id: string;
  short_url: string;
  status: string;
  amount: number;
  amount_paid: number;
  reference_id?: string;
  payments?: { payment_id: string; amount: number; status: string; method?: string; created_at?: number }[] | null;
};

export type RzpQr = { id: string; image_url: string; status: string; payment_amount?: number; payments_amount_received?: number };

export function createLink(
  keys: RzpKeys,
  p: { amount: number; referenceId: string; description: string; name: string; phone: string | null; expireBy: Date; acceptPartial: boolean; callbackUrl: string; notes: Record<string, string> }
) {
  return call<RzpLink>(keys, "POST", "/payment_links", {
    amount: p.amount,
    currency: "INR",
    accept_partial: p.acceptPartial,
    ...(p.acceptPartial ? { first_min_partial_amount: Math.min(p.amount, 100_00) } : {}),
    expire_by: Math.floor(p.expireBy.getTime() / 1000),
    reference_id: p.referenceId,
    description: p.description.slice(0, 2048),
    customer: { name: p.name.slice(0, 100), ...(p.phone ? { contact: `+91${p.phone}` } : {}) },
    // We send the link ourselves (WhatsApp / in-app), not Razorpay.
    notify: { sms: false, email: false },
    reminder_enable: false,
    notes: p.notes,
    callback_url: p.callbackUrl,
    callback_method: "get",
  });
}

export const fetchLink = (keys: RzpKeys, id: string) => call<RzpLink>(keys, "GET", `/payment_links/${encodeURIComponent(id)}`);
export const cancelLink = (keys: RzpKeys, id: string) => call<RzpLink>(keys, "POST", `/payment_links/${encodeURIComponent(id)}/cancel`);
export const fetchPayment = (keys: RzpKeys, id: string) => call<RzpPayment>(keys, "GET", `/payments/${encodeURIComponent(id)}`);

export function createQr(keys: RzpKeys, p: { amount: number; name: string; description: string; closeBy: Date; notes: Record<string, string> }) {
  return call<RzpQr>(keys, "POST", "/payments/qr_codes", {
    type: "upi_qr",
    name: p.name.slice(0, 40),
    usage: "single_use",
    fixed_amount: true,
    payment_amount: p.amount,
    description: p.description.slice(0, 120),
    close_by: Math.floor(p.closeBy.getTime() / 1000),
    notes: p.notes,
  });
}

export const qrPayments = (keys: RzpKeys, id: string) =>
  call<{ items: RzpPayment[] }>(keys, "GET", `/payments/qr_codes/${encodeURIComponent(id)}/payments`);
export const closeQr = (keys: RzpKeys, id: string) => call<RzpQr>(keys, "POST", `/payments/qr_codes/${encodeURIComponent(id)}/close`);

/** Is this webhook really from Razorpay (signed with our webhook secret)? */
export function validWebhook(rawBody: string, signature: string | null, secret: string) {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return sameText(expected, signature);
}

/** Sign a body as Razorpay would (tests, simulator). */
export const signWebhook = (rawBody: string, secret: string) => createHmac("sha256", secret).update(rawBody).digest("hex");

/** The bank reference shown to people: UPI RRN, then bank transaction id. */
export const paymentRef = (p: RzpPayment) => p.acquirer_data?.rrn || p.acquirer_data?.upi_transaction_id || p.acquirer_data?.bank_transaction_id || p.id;
