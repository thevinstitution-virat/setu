import type { Prisma, Role } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db";
import { ROLE_PERMISSIONS, type Permission } from "@/lib/permissions";
import { platformDomain } from "@/lib/tenant";
import { CHANNELS, eventOn, notifySettings, type Channel, type NotifySettings } from "@/lib/engage-settings";
import { EVENTS, channelAllowed, placeholders, render, type EventKey, type Lang } from "@/lib/notify-events";

/**
 * The notification centre. notify() runs INSIDE the business transaction:
 * it writes the in-app notifications and one outbox row (MessageLog, QUEUED)
 * per outside channel, so a message exists exactly when the change committed.
 * The worker's messages.flush job sends the queued rows (lib/outbox.ts).
 */

export type Vars = Record<string, string | number | null | undefined>;

export type NotifyInput = {
  event: EventKey;
  /** User ids. Inactive users are skipped. */
  to: string[];
  vars: Vars;
  /** In-app / push link (a path in this app). */
  link?: string | null;
  /** Stable id of the thing this is about, so retries never send twice (e.g. `order.placed:<orderId>`). */
  key?: string | null;
  /** WhatsApp: a document (invoice PDF) for the template header. */
  docUrl?: string | null;
  /** Announcements: the channels picked when publishing (instead of the event's settings). */
  channels?: Channel[];
};

const settingsCache = new WeakMap<object, Map<string, NotifySettings>>();

// Transactions that queued outside messages: withMoney wakes the sender after they commit.
const queued = new WeakSet<object>();
export const queuedMessages = (tx: object) => queued.has(tx);

async function settingsFor(tx: Tx, tenantId: string) {
  let m = settingsCache.get(tx);
  if (!m) settingsCache.set(tx, (m = new Map()));
  const hit = m.get(tenantId);
  if (hit) return hit;
  const t = await tx.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
  const s = notifySettings(t?.settings);
  m.set(tenantId, s);
  return s;
}

const asLang = (v: string | null | undefined): Lang => (v === "hi" ? "hi" : "en");

/** Send one event to some people. Returns how many in-app and outside messages were written. */
export async function notify(tx: Tx, tenantId: string, input: NotifyInput) {
  const ids = [...new Set(input.to.filter(Boolean))];
  if (!ids.length) return { inApp: 0, messages: 0 };
  const def = EVENTS[input.event];
  const [settings, users, templates, subs] = await Promise.all([
    settingsFor(tx, tenantId),
    tx.user.findMany({ where: { id: { in: ids }, active: true }, select: { id: true, phone: true, lang: true, mutes: true } }),
    tx.messageTemplate.findMany({ where: { event: input.event } }),
    tx.pushSubscription.groupBy({ by: ["userId"], where: { userId: { in: ids } }, _count: true }),
  ]);
  const hasPush = new Set(subs.map((s) => s.userId));
  const notes: Prisma.NotificationCreateManyInput[] = [];
  const msgs: Prisma.MessageLogCreateManyInput[] = [];

  for (const u of users) {
    const lang = asLang(u.lang);
    const own = templates.find((t) => t.lang === lang);
    const tpl = own ?? def[lang];
    const title = render(tpl.title, input.vars).slice(0, 200);
    const body = render(tpl.body, input.vars).slice(0, 1000);
    const key = input.key ? `${input.key}:${u.id}` : null;
    notes.push({ tenantId, userId: u.id, event: input.event, title, body, link: input.link ?? null, dedupeKey: key });

    const topic = "topic" in def ? def.topic : undefined;
    if (topic && u.mutes.includes(topic)) continue;
    const channels = input.channels ?? CHANNELS.filter((c) => eventOn(settings, input.event, c));
    for (const ch of channels) {
      if (!channelAllowed(input.event, ch)) continue; // staff: no SMS / WhatsApp cost (except the owner's summary)
      if (!settings.channels[ch] || u.mutes.includes(ch)) continue;
      if (ch === "push" && !hasPush.has(u.id)) continue;
      if (ch !== "push" && !u.phone) continue;
      msgs.push({
        tenantId,
        userId: u.id,
        channel: ch === "push" ? "PUSH" : ch === "sms" ? "SMS" : "WHATSAPP",
        to: ch === "push" ? "push" : u.phone!,
        event: input.event,
        lang,
        title,
        body,
        link: input.link ?? null,
        waTemplate: ch === "whatsapp" ? (own?.waTemplate ?? null) : null,
        params: ch === "whatsapp" ? placeholders(tpl.body).map((p) => String(input.vars[p] ?? "")) : undefined,
        docUrl: ch === "whatsapp" ? (input.docUrl ?? null) : null,
        dedupeKey: key ? `${key}:${ch}` : null,
      });
    }
  }
  if (msgs.length) queued.add(tx);
  const [a, b] = await Promise.all([
    notes.length ? tx.notification.createMany({ data: notes, skipDuplicates: true }) : { count: 0 },
    msgs.length ? tx.messageLog.createMany({ data: msgs, skipDuplicates: true }) : { count: 0 },
  ]);
  return { inApp: a.count, messages: b.count };
}

// ───────────────────────────── who gets it ─────────────────────────────

/** Active staff whose role has this permission (admins have all). */
export async function staffWith(tx: Tx, perm: Permission): Promise<string[]> {
  const roles = (Object.keys(ROLE_PERMISSIONS) as Role[]).filter((r) => r !== "RETAILER" && ROLE_PERMISSIONS[r].includes(perm));
  const rows = await tx.user.findMany({ where: { role: { in: roles }, active: true }, select: { id: true } });
  return rows.map((r) => r.id);
}

/** The retailer's login. */
export async function retailerUserId(tx: Tx, retailerId: string): Promise<string | null> {
  const r = await tx.retailerProfile.findUnique({ where: { id: retailerId }, select: { userId: true } });
  return r?.userId ?? null;
}

// ───────────────────────────── links in messages ─────────────────────────────

/** Public address of a business, for links inside SMS / WhatsApp (no request at hand in the worker). */
export async function tenantUrl(tx: Tx, tenantId: string, path = "/"): Promise<string> {
  const t = await tx.tenant.findUnique({ where: { id: tenantId }, select: { slug: true } });
  const domain = platformDomain();
  const scheme = process.env.PUBLIC_SCHEME ?? (domain === "localhost" ? "http" : "https");
  const port = process.env.PUBLIC_PORT ? `:${process.env.PUBLIC_PORT}` : "";
  return `${scheme}://${t?.slug ?? "app"}.${domain}${port}${path}`;
}
