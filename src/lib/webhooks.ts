import { createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import http from "node:http";
import https from "node:https";
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

/** IPv6 text → 8 numbers (handles "::" and a dotted IPv4 tail), or null. */
function v6Words(ip: string): number[] | null {
  let v = ip.toLowerCase().split("%")[0];
  const dotted = v.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const p = dotted[2].split(".").map(Number);
    if (p.some((n) => !(n >= 0 && n <= 255))) return null;
    v = `${dotted[1]}${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const halves = v.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const words = [...head, ...Array(fill).fill("0"), ...tail].map((h) => (/^[0-9a-f]{1,4}$/.test(h) ? parseInt(h, 16) : NaN));
  return words.length === 8 && words.every((n) => !Number.isNaN(n)) ? words : null;
}

function privateV4(ip: string) {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !(Number.isInteger(n) && n >= 0 && n <= 255))) return true; // unreadable: refuse
  const [a, b, c] = p;
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)) || (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113)
  );
}

/** True for loopback, private, link-local, reserved, and IPv6 forms that carry one (mapped, NAT64, 6to4). */
export function privateIp(ip: string): boolean {
  if (isIP(ip) === 4) return privateV4(ip);
  const w = v6Words(ip);
  if (!w) return true;
  const v4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  if (w.slice(0, 5).every((x) => x === 0) && (w[5] === 0xffff || w[5] === 0)) return w[5] === 0 && w[6] === 0 && w[7] <= 1 ? true : privateV4(v4(w[6], w[7])); // ::ffff:a.b.c.d, ::a.b.c.d, ::, ::1
  if (w[0] === 0x64 && w[1] === 0xff9b) return privateV4(v4(w[6], w[7])); // NAT64
  if (w[0] === 0x2002) return privateV4(v4(w[1], w[2])); // 6to4
  const top = w[0];
  return (top & 0xfe00) === 0xfc00 || (top & 0xffc0) === 0xfe80 || (top & 0xffc0) === 0xfec0 || (top & 0xff00) === 0xff00 || top === 0x2001 && w[1] === 0xdb8;
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

export class PrivateAddressError extends Error {
  constructor() {
    super("The address points into a private network");
  }
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | { address: string; family: number }[], family?: number) => void;

/**
 * DNS lookup for the socket itself: resolves, refuses if any answer is private,
 * and hands the socket exactly the addresses it checked. Checking first and
 * fetching after would resolve twice, and a hostile name server can answer a
 * public address the first time and a private one the second (DNS rebinding).
 */
export function pinnedLookup(hostname: string, options: { all?: boolean; family?: number } | number, cb: LookupCb) {
  const opts = typeof options === "number" ? { family: options } : (options ?? {});
  lookup(hostname, { all: true, family: opts.family || 0 })
    .then((addrs) => {
      if (!addrs.length) return cb(Object.assign(new Error(`No address for ${hostname}`), { code: "ENOTFOUND" }), "");
      if (!allowPrivate() && addrs.some((a) => privateIp(a.address))) return cb(new PrivateAddressError(), "");
      if (opts.all) cb(null, addrs);
      else cb(null, addrs[0].address, addrs[0].family);
    })
    .catch((e: NodeJS.ErrnoException) => cb(e, ""));
}

/** POST through a connection pinned to checked addresses. No redirects followed; the body is not read. */
function postPinned(url: string, headers: Record<string, string>, body: string, timeoutMs: number): Promise<number> {
  const u = new URL(url);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && !allowPrivate() && privateIp(host)) return Promise.reject(new PrivateAddressError());
  const mod = u.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(
      u,
      { method: "POST", headers: { ...headers, "Content-Length": String(Buffer.byteLength(body)) }, lookup: pinnedLookup as never, timeout: timeoutMs, agent: false },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      }
    );
    req.on("timeout", () => req.destroy(Object.assign(new Error("timeout"), { name: "TimeoutError" })));
    req.on("error", reject);
    req.end(body);
  });
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
  try {
    const status = await postPinned(
      url,
      { "Content-Type": "application/json", "User-Agent": "Setu-Webhooks/1", "Setu-Event": event, "Setu-Delivery": deliveryId, "Setu-Signature": sign(secret, body) },
      body,
      TIMEOUT_MS
    );
    const ok = status >= 200 && status < 300;
    return { ok, code: status, error: ok ? null : status >= 300 && status < 400 ? "Redirects are not followed" : `Answered ${status}`, ms: Date.now() - started };
  } catch (e) {
    const err = e as Error;
    if (err instanceof PrivateAddressError) return { ok: false, code: null, error: err.message, ms: 0 };
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
      data: { endpointId: e.id, event: "ping", eventKey: `ping:${Date.now()}:${token(4)}`, payload: { event: "ping", created_at: new Date().toISOString(), data: { message: "Test from VBiz Pro" } } },
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
