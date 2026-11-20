import type { AnnouncementAudience, Prisma, Role } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db";
import type { Ctx } from "@/lib/ledger";
import { MoneyError } from "@/lib/money-error";
import { notify } from "@/lib/notify";
import type { Channel } from "@/lib/engage-settings";
import { keyBelongsTo } from "@/lib/storage";

/**
 * Announcements: a notice to retailers in some areas / groups, or to staff
 * by role. Always shown in the app while live (startsAt..endsAt); when
 * published it is also sent once on the channels picked (push, WhatsApp,
 * SMS). Retailers who muted "promo" see it in the app only.
 */

const fail = (m: string, status = 400) => new MoneyError(m, status);
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const ids = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && x.length < 40))] : []);
const STAFF_ROLES: Role[] = ["ADMIN", "SALES_AGENT", "DELIVERY_AGENT", "SUPERVISOR"];
const AUDIENCES: AnnouncementAudience[] = ["RETAILERS", "STAFF", "ALL"];
const CH: Channel[] = ["push", "whatsapp", "sms"];

export type AnnouncementInput = {
  title?: unknown;
  body?: unknown;
  audience?: unknown;
  areaIds?: unknown;
  groupIds?: unknown;
  roles?: unknown;
  link?: unknown;
  imageKey?: unknown;
  pinned?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  channels?: unknown;
};

function parse(input: AnnouncementInput, now: Date) {
  const title = text(input.title, 80);
  const body = text(input.body, 600);
  if (!title) throw fail("Write a title");
  if (!body) throw fail("Write the message");
  const audience = (AUDIENCES as string[]).includes(String(input.audience)) ? (input.audience as AnnouncementAudience) : "RETAILERS";
  const roles = ids(input.roles).filter((r): r is Role => (STAFF_ROLES as string[]).includes(r));
  const link = text(input.link, 200) || null;
  // A page in this app: "/x", never "//host" or "/\host" (browsers read those as another site).
  if (link && !/^\/(?![/\\])/.test(link)) throw fail("Link must be a page in this app, like /retailer/catalogue");
  const startsAt = input.startsAt ? new Date(String(input.startsAt)) : now;
  const endsAt = input.endsAt ? new Date(String(input.endsAt)) : null;
  if (Number.isNaN(startsAt.getTime()) || (endsAt && Number.isNaN(endsAt.getTime()))) throw fail("Pick valid dates");
  if (endsAt && endsAt <= startsAt) throw fail("End must be after the start");
  const channels = ids(input.channels).filter((c): c is Channel => (CH as string[]).includes(c));
  const imageKey = text(input.imageKey, 200) || null;
  return {
    title,
    body,
    audience,
    areaIds: audience === "STAFF" ? [] : ids(input.areaIds),
    groupIds: audience === "STAFF" ? [] : ids(input.groupIds),
    roles: audience === "RETAILERS" ? [] : roles,
    link,
    imageKey,
    pinned: input.pinned === true,
    startsAt,
    endsAt,
    channels,
  };
}

export async function saveAnnouncement(ctx: Ctx, by: string, id: string | null, input: AnnouncementInput, now = new Date()) {
  const data = parse(input, now);
  if (data.imageKey && !keyBelongsTo(data.imageKey, ctx.tenantId)) throw fail("Bad image");
  if (!id) return ctx.tx.announcement.create({ data: { ...data, createdById: by } });
  const a = await ctx.tx.announcement.findUnique({ where: { id } });
  if (!a) throw fail("Announcement not found", 404);
  // Once sent, who got it and on which channels can't change; the text and dates still can.
  if (a.publishedAt) {
    const { audience: _a, areaIds: _ar, groupIds: _g, roles: _r, channels: _c, ...rest } = data;
    void [_a, _ar, _g, _r, _c];
    return ctx.tx.announcement.update({ where: { id }, data: rest });
  }
  return ctx.tx.announcement.update({ where: { id }, data });
}

/** Who the announcement is for (user ids). */
export async function audienceOf(tx: Tx, a: { audience: AnnouncementAudience; areaIds: string[]; groupIds: string[]; roles: string[] }) {
  const out: string[] = [];
  if (a.audience !== "STAFF") {
    const where: Prisma.RetailerProfileWhereInput = { user: { active: true } };
    const or: Prisma.RetailerProfileWhereInput[] = [];
    if (a.areaIds.length) or.push({ areaId: { in: a.areaIds } });
    if (a.groupIds.length) or.push({ groups: { some: { groupId: { in: a.groupIds } } } });
    if (or.length) where.OR = or;
    out.push(...(await tx.retailerProfile.findMany({ where, select: { userId: true } })).map((r) => r.userId));
  }
  if (a.audience !== "RETAILERS") {
    const roles = (a.roles.length ? a.roles : STAFF_ROLES) as Role[];
    out.push(...(await tx.user.findMany({ where: { active: true, role: { in: roles.filter((r) => r !== "RETAILER") } }, select: { id: true } })).map((u) => u.id));
  }
  return [...new Set(out)];
}

/** Send it: in-app to everyone in the audience, plus the picked channels. Once only. */
export async function publishAnnouncement(ctx: Ctx, id: string, now = new Date()) {
  const a = await ctx.tx.announcement.findUnique({ where: { id } });
  if (!a) throw fail("Announcement not found", 404);
  if (a.publishedAt) throw fail("Already sent", 409);
  if (a.endsAt && a.endsAt <= now) throw fail("This announcement has ended", 409);
  const to = await audienceOf(ctx.tx, a);
  if (!to.length) throw fail("Nobody matches this audience", 409);
  const retailerIds = new Set(
    (await ctx.tx.user.findMany({ where: { id: { in: to }, role: "RETAILER" }, select: { id: true } })).map((u) => u.id)
  );
  const vars = { title: a.title, body: a.body };
  const channels = a.channels as Channel[];
  const shops = to.filter((u) => retailerIds.has(u));
  const staff = to.filter((u) => !retailerIds.has(u));
  let sent = 0;
  if (shops.length) sent += (await notify(ctx.tx, ctx.tenantId, { event: "announcement", to: shops, vars, key: `announcement:${a.id}`, link: a.link ?? "/retailer", channels })).inApp;
  if (staff.length) sent += (await notify(ctx.tx, ctx.tenantId, { event: "staff.announcement", to: staff, vars, key: `announcement:${a.id}`, link: a.link ?? null, channels: channels.filter((c) => c === "push") })).inApp;
  return ctx.tx.announcement.update({ where: { id: a.id }, data: { publishedAt: now, sentCount: sent } });
}

/** Live announcements for one person (the app's home cards). */
export async function liveFor(tx: Tx, user: { id: string; role: Role }, now = new Date()) {
  const base: Prisma.AnnouncementWhereInput = { publishedAt: { not: null }, startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] };
  if (user.role === "RETAILER") {
    const r = await tx.retailerProfile.findUnique({ where: { userId: user.id }, select: { areaId: true, groups: { select: { groupId: true } } } });
    if (!r) return [];
    const groups = r.groups.map((g) => g.groupId);
    const rows = await tx.announcement.findMany({ where: { ...base, audience: { in: ["RETAILERS", "ALL"] } }, orderBy: [{ pinned: "desc" }, { startsAt: "desc" }], take: 20 });
    return rows.filter((a) => (!a.areaIds.length && !a.groupIds.length) || a.areaIds.includes(r.areaId) || a.groupIds.some((g) => groups.includes(g))).slice(0, 5);
  }
  const rows = await tx.announcement.findMany({ where: { ...base, audience: { in: ["STAFF", "ALL"] } }, orderBy: [{ pinned: "desc" }, { startsAt: "desc" }], take: 20 });
  return rows.filter((a) => !a.roles.length || a.roles.includes(user.role)).slice(0, 5);
}
