import webpush from "web-push";
import { meter } from "@/lib/billing";
import type { MessageLog } from "@/generated/prisma/client";
import { asPlatform, withTenantTx } from "@/lib/db";

/**
 * Sends queued outbox rows (MessageLog). Runs in the worker (messages.flush):
 * right after a business change, and every minute as a sweep.
 *
 * Providers are switched on by environment variables. Without one, a
 * message is kept as LOGGED (what would have gone out) and nothing leaves
 * the server, the same rule as OTP SMS before the owner picks a provider.
 *
 *   Push      VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto: or https:)
 *   WhatsApp  WHATSAPP_PROVIDER=meta, WHATSAPP_TOKEN, WHATSAPP_PHONE_ID [, WHATSAPP_API_VERSION]
 *   SMS       SMS_PROVIDER (none built yet: the owner adds one later)
 */

export const MAX_ATTEMPTS = 3;

type Outcome = { status: "SENT" | "FAILED" | "LOGGED" | "SKIPPED"; provider?: string; providerId?: string | null; error?: string | null };

// ───────────────────────────── channels ─────────────────────────────

export function pushConfigured() {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export function channelStatus() {
  return {
    push: pushConfigured() ? "ready" : "not set up",
    whatsapp: process.env.WHATSAPP_PROVIDER === "meta" && process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID ? "ready" : "not set up",
    sms: process.env.SMS_PROVIDER ? `provider ${process.env.SMS_PROVIDER} not built yet` : "not set up",
  } as const;
}

async function sendPush(tenantId: string, m: MessageLog): Promise<Outcome> {
  if (!pushConfigured()) return { status: "LOGGED", provider: "log" };
  if (!m.userId) return { status: "SKIPPED", error: "No person" };
  webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? "mailto:support@example.com", process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  const subs = await withTenantTx(tenantId, (tx) => tx.pushSubscription.findMany({ where: { userId: m.userId! } }));
  if (!subs.length) return { status: "SKIPPED", provider: "webpush", error: "No phone or browser subscribed" };
  const payload = JSON.stringify({ title: m.title ?? "", body: m.body, link: m.link ?? "/", tag: m.dedupeKey ?? m.id });
  let sent = 0;
  let lastError = "";
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 24 * 3600 });
      sent++;
      await withTenantTx(tenantId, (tx) => tx.pushSubscription.update({ where: { id: s.id }, data: { lastUsedAt: new Date() } }));
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      // Gone: the browser unsubscribed or the app was removed. Forget it.
      if (code === 404 || code === 410) await withTenantTx(tenantId, (tx) => tx.pushSubscription.deleteMany({ where: { id: s.id } }));
      else lastError = (e as Error).message ?? String(e);
    }
  }
  if (sent) return { status: "SENT", provider: "webpush", providerId: `${sent}/${subs.length}` };
  return lastError ? { status: "FAILED", provider: "webpush", error: lastError.slice(0, 300) } : { status: "SKIPPED", provider: "webpush", error: "No phone or browser subscribed" };
}

/** Indian 10-digit mobile → international digits for WhatsApp. */
export const waNumber = (phone: string) => (/^\d{10}$/.test(phone) ? `91${phone}` : phone.replace(/\D/g, ""));

/** The Cloud API request body for a template message (exported for tests). */
export function whatsappBody(m: Pick<MessageLog, "to" | "lang" | "waTemplate" | "params" | "docUrl" | "event">) {
  const params = Array.isArray(m.params) ? (m.params as unknown[]).map((p) => String(p ?? "")) : [];
  const components: unknown[] = [];
  if (m.docUrl) components.push({ type: "header", parameters: [{ type: "document", document: { link: m.docUrl, filename: `${m.event}.pdf` } }] });
  if (params.length) components.push({ type: "body", parameters: params.map((text) => ({ type: "text", text: text || "-" })) });
  return {
    messaging_product: "whatsapp",
    to: waNumber(m.to),
    type: "template",
    template: { name: m.waTemplate, language: { code: m.lang === "hi" ? "hi" : "en" }, components },
  };
}

async function sendWhatsapp(m: MessageLog): Promise<Outcome> {
  const ready = process.env.WHATSAPP_PROVIDER === "meta" && process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID;
  if (!ready) return { status: "LOGGED", provider: "log" };
  // Messages a business starts must use a template WhatsApp approved for it.
  if (!m.waTemplate) return { status: "FAILED", provider: "meta", error: "No approved WhatsApp template is set for this message (Settings → Messages → wording)" };
  const version = process.env.WHATSAPP_API_VERSION ?? "v21.0";
  const res = await fetch(`https://graph.facebook.com/${version}/${process.env.WHATSAPP_PHONE_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(whatsappBody(m)),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
  if (!res.ok) return { status: "FAILED", provider: "meta", error: (data.error?.message ?? `HTTP ${res.status}`).slice(0, 300) };
  return { status: "SENT", provider: "meta", providerId: data.messages?.[0]?.id ?? null };
}

async function sendSms(): Promise<Outcome> {
  if (!process.env.SMS_PROVIDER) return { status: "LOGGED", provider: "log" };
  return { status: "FAILED", provider: process.env.SMS_PROVIDER, error: `SMS provider "${process.env.SMS_PROVIDER}" is not built yet` };
}

async function deliver(tenantId: string, m: MessageLog): Promise<Outcome> {
  try {
    if (m.channel === "PUSH") return await sendPush(tenantId, m);
    if (m.channel === "WHATSAPP") return await sendWhatsapp(m);
    return await sendSms();
  } catch (e) {
    return { status: "FAILED", error: ((e as Error).message ?? String(e)).slice(0, 300) };
  }
}

// ───────────────────────────── flush ─────────────────────────────

/** Send what is queued for one business (and retry recent failures). */
export async function flushTenant(tenantId: string, limit = 200, now = new Date()) {
  const retryAfter = new Date(now.getTime() - 5 * 60_000);
  const rows = await withTenantTx(tenantId, (tx) =>
    tx.messageLog.findMany({
      where: {
        OR: [
          { status: "QUEUED" },
          // Failed in the last day: try again, at most MAX_ATTEMPTS times, 5 minutes apart.
          { status: "FAILED", attempts: { lt: MAX_ATTEMPTS }, createdAt: { gt: new Date(now.getTime() - 24 * 3600_000) }, sentAt: { lt: retryAfter } },
        ],
      },
      orderBy: { createdAt: "asc" },
      take: limit,
    })
  );
  const tally = { SENT: 0, FAILED: 0, LOGGED: 0, SKIPPED: 0 };
  for (const m of rows) {
    // Claim it: only one sender handles a row (a second flush sees attempts moved on).
    const claimed = await withTenantTx(tenantId, (tx) =>
      tx.messageLog.updateMany({ where: { id: m.id, attempts: m.attempts, status: m.status }, data: { attempts: { increment: 1 } } })
    );
    if (!claimed.count) continue;
    const out = await deliver(tenantId, m);
    tally[out.status]++;
    await withTenantTx(tenantId, async (tx) => {
      await tx.messageLog.update({
        where: { id: m.id },
        data: { status: out.status, provider: out.provider ?? null, providerId: out.providerId ?? null, error: out.error ?? null, sentAt: new Date() },
      });
      // Paid channels count toward the business's usage (platform cost view).
      if (out.status === "SENT" && m.channel !== "PUSH") await meter(tx, tenantId, "messages");
    });
  }
  return tally;
}

/** Every business with something to send. */
export async function flushAll() {
  const tenants = await asPlatform((tx) =>
    tx.messageLog.findMany({
      where: { OR: [{ status: "QUEUED" }, { status: "FAILED", attempts: { lt: MAX_ATTEMPTS }, createdAt: { gt: new Date(Date.now() - 24 * 3600_000) } }] },
      distinct: ["tenantId"],
      select: { tenantId: true },
    })
  );
  const out = { SENT: 0, FAILED: 0, LOGGED: 0, SKIPPED: 0 };
  for (const t of tenants) {
    const r = await flushTenant(t.tenantId);
    for (const k of Object.keys(out) as (keyof typeof out)[]) out[k] += r[k];
  }
  return out;
}
