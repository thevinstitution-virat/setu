import { createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db";
import { asPlatform, withTenantTx } from "@/lib/db";
import { emit } from "@/lib/jobs";
import { decryptSecret, encryptSecret, token } from "@/lib/secrets";
import { invoiceDto, invoiceSelect, orderDto, orderSelect, paymentDto, paymentSelect, retailerDto, retailerSelect } from "@/lib/public-api";

/**
 * Outbound webhooks: signed POSTs to the business's own software when things
 * happen. Rows are written inside the business transaction (an outbox), so an
 * event is sent only if the change was saved, and the worker sends them with
 * retries. Each POST carries
 *   Setu-Event: order.placed
 *   Setu-Delivery: <id> (the same on retries; use it to ignore repeats)
 *   Setu-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>
 */

export const WEBHOOK_EVENTS = {
  "order.placed": "An order was placed",
  "order.status_changed": "An order moved on (confirmed, packed, out for delivery, delivered, cancelled)",
  "invoice.issued": "An invoice, credit note or debit note was issued",
  "payment.received": "A payment was confirmed",
  "retailer.created": "A new shop was added",
} as const;
export type WebhookEvent = keyof typeof WEBHOOK_EVENTS;

/** Wait this long after attempt n fails (then the delivery is given up). */
export const BACKOFF_MINUTES = [1, 5, 30, 120, 360, 720];
export const MAX_ATTEMPTS = BACKOFF_MINUTES.length + 1;
export const DISABLE_AFTER = 20;
export const MAX_ENDPOINTS = 10;
const TIMEOUT_MS = 10_000;

// ───────────────────────────── URL safety ─────────────────────────────

const allowPrivate = () => process.env.ALLOW_PRIVATE_WEBHOOKS === "1";

function privateIp(ip: string) {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v.startsWith("::ffff:")) return privateIp(v.slice(7));
    return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb");
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

/** Shape check when saving an endpoint. */
export function checkWebhookUrl(raw: unknown): string | { url: string } {
  if (typeof raw !== "string" || !raw.trim()) return "Enter the address to send to";
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return "That address is not valid";
  }
  if (u.protocol !== "https:" && !(allowPrivate() && u.protocol === "http:")) return "The address must start with https://";
  if (u.username || u.password) return "Leave the user name and password out of the address";
  if (u.toString().length > 500) return "The address is too long";
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!allowPrivate() && (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || (isIP(host) && privateIp(host)))) return "That address is inside a private network";
  return { url: u.toString() };
}

/** Right before sending: the name must not point into a private network. */
async function resolvesPublic(url: string) {
  if (allowPrivate()) return true;
  const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return !privateIp(host);
  const addrs = await lookup(host, { all: true }).catch(() => []);
  return addrs.length > 0 && addrs.every((a) => !privateIp(a.address));
}

// ───────────────────────────── endpoints ─────────────────────────────

export const newWebhookSecret = () => `whsec_${token(24)}`;

export function parseEvents(v: unknown): WebhookEvent[] | string {
  if (!Array.isArray(v) || !v.length) return "Choose at least one event";
  const out = [...new Set(v.filter((e): e is WebhookEvent => typeof e === "string" && e in WEBHOOK_EVENTS))];
  return out.length === v.length ? out : "Unknown event in the list";
}

export const sealSecret = encryptSecret;

export function sign(secret: string, body: string, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

// ───────────────────────────── outbox ─────────────────────────────

/**
 * Queue one event for every active endpoint that wants it. `key` makes it
 * once-only per endpoint (e.g. "order.placed:<orderId>").
 */
export async function emitWebhook(tx: Tx, tenantId: string, event: WebhookEvent, key: string, data: unknown) {
  const endpoints = await tx.webhookEndpoint.findMany({ where: { active: true, events: { has: event } }, select: { id: true } });
  if (!endpoints.length) return 0;
  const created = new Date();
  const r = await tx.webhookDelivery.createMany({
    data: endpoints.map((e) => ({
      endpointId: e.id,
      event,
      eventKey: key.slice(0, 200),
      payload: { event, created_at: created.toISOString(), data } as Prisma.InputJsonValue,
    })),
    skipDuplicates: true,
  });
  if (r.count) await emit("webhooks.flush", { tenantId }, { singletonKey: `wh:${tenantId}`, singletonSeconds: 3, startAfter: 2, retryLimit: 1 });
  return r.count;
}

// The events, each with the same shape the public API returns.

export async function orderWebhook(tx: Tx, tenantId: string, orderId: string, event: "order.placed" | "order.status_changed", from?: string | null) {
  if (!(await tx.webhookEndpoint.count({ where: { active: true, events: { has: event } } }))) return 0;
  const o = await tx.order.findUnique({ where: { id: orderId }, select: orderSelect });
  if (!o) return 0;
  const key = event === "order.placed" ? `order.placed:${o.id}` : `order.status:${o.id}:${o.status}:${o.updatedAt.getTime()}`;
  return emitWebhook(tx, tenantId, event, key, { ...orderDto(o), ...(from ? { previous_status: from } : {}) });
}

export async function invoiceWebhook(tx: Tx, tenantId: string, invoiceId: string) {
  if (!(await tx.webhookEndpoint.count({ where: { active: true, events: { has: "invoice.issued" } } }))) return 0;
  const i = await tx.invoice.findUnique({ where: { id: invoiceId }, select: invoiceSelect });
  return i ? emitWebhook(tx, tenantId, "invoice.issued", `invoice.issued:${i.id}`, invoiceDto(i)) : 0;
}

export async function paymentWebhook(tx: Tx, tenantId: string, paymentId: string) {
  if (!(await tx.webhookEndpoint.count({ where: { active: true, events: { has: "payment.received" } } }))) return 0;
  const p = await tx.payment.findUnique({ where: { id: paymentId }, select: paymentSelect });
  return p && p.state === "CONFIRMED" ? emitWebhook(tx, tenantId, "payment.received", `payment.received:${p.id}`, paymentDto(p)) : 0;
}

export async function retailerWebhook(tx: Tx, tenantId: string, retailerId: string) {
  if (!(await tx.webhookEndpoint.count({ where: { active: true, events: { has: "retailer.created" } } }))) return 0;
  const r = await tx.retailerProfile.findUnique({ where: { id: retailerId }, select: retailerSelect });
  return r ? emitWebhook(tx, tenantId, "retailer.created", `retailer.created:${r.id}`, retailerDto(r)) : 0;
}

// ───────────────────────────── sending ─────────────────────────────

type SendResult = { ok: boolean; code: number | null; error: string | null; ms: number };

async function send(url: string, secret: string, event: string, deliveryId: string, body: string): Promise<SendResult> {
  const started = Date.now();
  if (!(await resolvesPublic(url))) return { ok: false, code: null, error: "The address points into a private network", ms: 0 };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "Setu-Webhooks/1", "Setu-Event": event, "Setu-Delivery": deliveryId, "Setu-Signature": sign(secret, body) },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    await res.body?.cancel().catch(() => null);
    const ok = res.status >= 200 && res.status < 300;
    return { ok, code: res.status, error: ok ? null : res.status >= 300 && res.status < 400 ? "Redirects are not followed" : `Answered ${res.status}`, ms: Date.now() - started };
  } catch (e) {
    const err = e as Error;
    return { ok: false, code: null, error: err.name === "TimeoutError" ? "No answer in 10 seconds" : (err.message ?? "Could not connect").slice(0, 200), ms: Date.now() - started };
  }
}

/** Send what is due for one business (the worker, after a change and every minute). */
export async function flushWebhooks(tenantId: string, now = new Date(), limit = 50) {
  const due = await withTenantTx(tenantId, (tx) =>
    tx.webhookDelivery.findMany({
      where: { status: { in: ["PENDING", "FAILED"] }, nextAttemptAt: { lte: now }, endpoint: { active: true } },
      orderBy: { nextAttemptAt: "asc" },
      take: limit,
      include: { endpoint: { select: { id: true, url: true, secret: true } } },
    })
  );
  const counts = { sent: 0, failed: 0, dead: 0 };
  for (const d of due) {
    // Claim it so a second worker does not send it too.
    const claimed = await withTenantTx(tenantId, (tx) =>
      tx.webhookDelivery.updateMany({ where: { id: d.id, nextAttemptAt: d.nextAttemptAt, status: d.status }, data: { nextAttemptAt: new Date(now.getTime() + 2 * 60_000) } })
    );
    if (!claimed.count) continue;
    const r = await deliver(tenantId, d, d.endpoint, now);
    counts[r]++;
  }
  return counts;
}

async function deliver(
  tenantId: string,
  d: { id: string; event: string; payload: Prisma.JsonValue; attempts: number },
  endpoint: { id: string; url: string; secret: string },
  now: Date
): Promise<"sent" | "failed" | "dead"> {
  const secret = decryptSecret(endpoint.secret) ?? "";
  const body = JSON.stringify({ id: d.id, ...(d.payload as object) });
  const r = secret ? await send(endpoint.url, secret, d.event, d.id, body) : { ok: false, code: null, error: "The signing secret could not be read", ms: 0 };
  const attempts = d.attempts + 1;
  const outcome = r.ok ? "sent" : attempts >= MAX_ATTEMPTS ? "dead" : "failed";
  await withTenantTx(tenantId, async (tx) => {
    await tx.webhookDelivery.update({
      where: { id: d.id },
      data: {
        status: r.ok ? "SENT" : outcome === "dead" ? "DEAD" : "FAILED",
        attempts,
        lastCode: r.code,
        lastError: r.error,
        durationMs: r.ms,
        sentAt: r.ok ? new Date() : null,
        nextAttemptAt: r.ok || outcome === "dead" ? now : new Date(now.getTime() + BACKOFF_MINUTES[attempts - 1] * 60_000),
      },
    });
    if (r.ok) await tx.webhookEndpoint.updateMany({ where: { id: endpoint.id, failStreak: { gt: 0 } }, data: { failStreak: 0 } });
    else {
      const e = await tx.webhookEndpoint.update({ where: { id: endpoint.id }, data: { failStreak: { increment: 1 } } });
      if (e.failStreak >= DISABLE_AFTER && e.active) {
        await tx.webhookEndpoint.update({ where: { id: endpoint.id }, data: { active: false, disabledReason: `Turned off after ${DISABLE_AFTER} failed sends in a row (last: ${r.error ?? "error"})` } });
      }
    }
  });
  return outcome;
}

/** "Send test event": one ping, sent now, result shown on screen. */
export async function sendTest(tenantId: string, endpointId: string) {
  const d = await withTenantTx(tenantId, async (tx) => {
    const e = await tx.webhookEndpoint.findUnique({ where: { id: endpointId }, select: { id: true, url: true, secret: true } });
    if (!e) return null;
    const row = await tx.webhookDelivery.create({
      data: { endpointId: e.id, event: "ping", eventKey: `ping:${Date.now()}:${token(4)}`, payload: { event: "ping", created_at: new Date().toISOString(), data: { message: "Test from Setu" } } },
    });
    return { row, e };
  });
  if (!d) return null;
  const outcome = await deliver(tenantId, d.row, d.e, new Date());
  const row = await withTenantTx(tenantId, (tx) => tx.webhookDelivery.findUniqueOrThrow({ where: { id: d.row.id } }));
  // A test is not retried.
  if (outcome === "failed") await withTenantTx(tenantId, (tx) => tx.webhookDelivery.update({ where: { id: row.id }, data: { status: "DEAD" } }));
  return { ok: outcome === "sent", code: row.lastCode, error: row.lastError, ms: row.durationMs };
}

/** Send again now (a dead or failed delivery). */
export async function redeliver(tenantId: string, deliveryId: string) {
  return withTenantTx(tenantId, (tx) =>
    tx.webhookDelivery.updateMany({ where: { id: deliveryId, status: { in: ["FAILED", "DEAD"] } }, data: { status: "PENDING", attempts: 0, nextAttemptAt: new Date(), lastError: null } })
  );
}

export async function flushAllWebhooks() {
  const tenants = await asPlatform((tx) => tx.webhookDelivery.groupBy({ by: ["tenantId"], where: { status: { in: ["PENDING", "FAILED"] }, nextAttemptAt: { lte: new Date() } } }));
  let sent = 0;
  for (const t of tenants) sent += (await flushWebhooks(t.tenantId)).sent;
  return sent;
}
