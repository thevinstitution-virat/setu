import type { TicketStatus } from "@/generated/prisma/client";
import type { Ctx } from "@/lib/ledger";
import type { Tx } from "@/lib/db";
import { MoneyError } from "@/lib/money-error";
import { fyLabel, nextSequence } from "@/lib/orders";
import { formatINR } from "@/lib/money";
import { notify, staffWith } from "@/lib/notify";
import {
  FEEDBACK_TAGS,
  isTicketCategory,
  slaHoursFor,
  supportSettings,
  TICKET_CATEGORIES,
  TICKET_NEXT,
  type FeedbackTag,
} from "@/lib/engage-settings";

/**
 * Complaints (tickets) with an SLA, and the retailer's rating of a delivery.
 *
 * Status: OPEN → IN_PROGRESS → (WAITING ↔ IN_PROGRESS) → RESOLVED → CLOSED.
 * The retailer can answer (WAITING → IN_PROGRESS) and reopen a resolved
 * complaint until it closes; resolved complaints close by themselves after
 * `support.autoCloseDays`. The SLA clock is the category's hours from the
 * moment it was raised; the first office reply is recorded separately.
 */

const fail = (m: string, status = 400) => new MoneyError(m, status);
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
/** Photo keys from this business's own uploads only. */
const keys = (v: unknown, max: number, tenantId: string) =>
  Array.isArray(v)
    ? v.filter((k): k is string => typeof k === "string" && k.startsWith(`t/${tenantId}/ticket-photo/`) && /^[\w./-]+$/.test(k) && !k.includes("..")).slice(0, max)
    : [];

export const STATUS_TEXT: Record<TicketStatus, { en: string; hi: string }> = {
  OPEN: { en: "received", hi: "मिल गई" },
  IN_PROGRESS: { en: "being worked on", hi: "पर काम चल रहा है" },
  WAITING: { en: "waiting for your answer", hi: "आपके जवाब का इंतज़ार" },
  RESOLVED: { en: "resolved", hi: "हल हो गई" },
  CLOSED: { en: "closed", hi: "बंद" },
};

async function settings(tx: Tx, tenantId: string) {
  const t = await tx.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
  return supportSettings(t?.settings);
}

export type RaiseInput = { retailerId: string; orderId?: string | null; category: unknown; subject: unknown; body: unknown; photoKeys?: unknown };

/** A retailer (or staff for them) raises a complaint. The caller checks who may raise for this shop. */
export async function raiseTicket(ctx: Ctx, by: string, input: RaiseInput, now = new Date()) {
  if (!isTicketCategory(input.category)) throw fail("Pick what the problem is");
  const body = text(input.body, 2000);
  if (body.length < 5) throw fail("Tell us a little more (at least 5 letters)");
  const subject = text(input.subject, 120) || TICKET_CATEGORIES[input.category].label;
  const retailer = await ctx.tx.retailerProfile.findUnique({ where: { id: input.retailerId }, select: { id: true, outletName: true } });
  if (!retailer) throw fail("Shop not found", 404);
  let orderId: string | null = null;
  if (input.orderId) {
    const o = await ctx.tx.order.findUnique({ where: { id: input.orderId }, select: { id: true, retailerId: true } });
    if (!o || o.retailerId !== retailer.id) throw fail("That order is not this shop's", 404);
    orderId = o.id;
    const open = await ctx.tx.ticket.findFirst({ where: { orderId, category: input.category, status: { in: ["OPEN", "IN_PROGRESS", "WAITING"] } }, select: { number: true } });
    if (open) throw fail(`Complaint ${open.number} about this order is already open. Add to it instead.`, 409);
  }
  const s = await settings(ctx.tx, ctx.tenantId);
  const fy = fyLabel(now);
  const number = `TKT${fy}-${String(await nextSequence(ctx.tx, ctx.tenantId, `ticket:${fy}`)).padStart(5, "0")}`;
  const ticket = await ctx.tx.ticket.create({
    data: {
      number,
      retailerId: retailer.id,
      orderId,
      category: input.category,
      subject,
      priority: ["damaged", "missing", "expired"].includes(input.category) ? "high" : "normal",
      createdById: by,
      slaDueAt: new Date(now.getTime() + slaHoursFor(s, input.category) * 3600_000),
      createdAt: now,
      messages: { create: { tenantId: ctx.tenantId, createdAt: now, authorId: by, body, photoKeys: keys(input.photoKeys, 4, ctx.tenantId) } },
    },
  });
  await notify(ctx.tx, ctx.tenantId, {
    event: "staff.ticket",
    to: await staffWith(ctx.tx, "tickets.manage"),
    key: `staff.ticket:${ticket.id}`,
    link: `/admin/complaints/${ticket.id}`,
    vars: { ticket: number, outlet: retailer.outletName, category: TICKET_CATEGORIES[input.category].label },
  });
  return ticket;
}

export type ReplyInput = { body?: unknown; photoKeys?: unknown; internal?: unknown; status?: unknown; assignedToId?: unknown; priority?: unknown };

const NEXT: Record<TicketStatus, TicketStatus[]> = TICKET_NEXT;

/** The office answers, changes status, assigns or adds an internal note. */
export async function officeReply(ctx: Ctx, by: string, ticketId: string, input: ReplyInput, now = new Date()) {
  const t = await ctx.tx.ticket.findUnique({ where: { id: ticketId }, include: { retailer: { select: { userId: true } } } });
  if (!t) throw fail("Complaint not found", 404);
  if (t.status === "CLOSED") throw fail("This complaint is closed", 409);
  const body = text(input.body, 2000);
  const internal = input.internal === true;
  const status = typeof input.status === "string" && input.status ? (input.status as TicketStatus) : null;
  if (status && status !== t.status && !NEXT[t.status].includes(status)) throw fail(`A ${t.status.toLowerCase().replace("_", " ")} complaint can't move to ${status.toLowerCase().replace("_", " ")}`, 409);
  if (status === "RESOLVED" && (!body || internal)) throw fail("Say how it was resolved, in a message the retailer can see");
  if (status === "WAITING" && (!body || internal)) throw fail("Ask the retailer something they can see");
  const data: Record<string, unknown> = {};
  if ("assignedToId" in input) {
    const a = typeof input.assignedToId === "string" && input.assignedToId ? input.assignedToId : null;
    if (a && !(await staffWith(ctx.tx, "tickets.manage")).includes(a)) throw fail("Assign it to someone who handles complaints");
    data.assignedToId = a;
  }
  if (input.priority === "high" || input.priority === "normal") data.priority = input.priority;
  if (!body && !status && !Object.keys(data).length) throw fail("Write a reply or change something");
  const newStatus = status && status !== t.status ? status : null;
  // Any reply the retailer can see starts work on a new complaint.
  const effective = newStatus ?? (t.status === "OPEN" && body && !internal ? "IN_PROGRESS" : null);
  if (effective) {
    data.status = effective;
    if (effective === "RESOLVED") data.resolvedAt = now;
    if (effective === "CLOSED") data.closedAt = now;
    if (t.status === "RESOLVED" && effective === "IN_PROGRESS") data.resolvedAt = null;
  }
  if (body && !internal && !t.firstResponseAt) data.firstResponseAt = now;
  const updated = await ctx.tx.ticket.update({ where: { id: t.id }, data: { ...data, updatedAt: now } });
  if (body || effective) {
    await ctx.tx.ticketMessage.create({
      data: { ticketId: t.id, createdAt: now, authorId: by, body: body || "", photoKeys: keys(input.photoKeys, 4, ctx.tenantId), internal, change: effective ? `${t.status}>${effective}` : null },
    });
  }
  if ((body && !internal) || effective) {
    const st = STATUS_TEXT[(effective ?? t.status) as TicketStatus];
    await notify(ctx.tx, ctx.tenantId, {
      event: "ticket.update",
      to: [t.retailer.userId],
      key: `ticket.update:${t.id}:${now.getTime()}`,
      link: `/retailer/help/${t.id}`,
      vars: { ticket: t.number, status: st.en, note: internal ? "" : body.slice(0, 300) },
    });
  }
  return updated;
}

/** The retailer adds to their complaint, or reopens a resolved one. */
export async function retailerReply(ctx: Ctx, by: string, retailerId: string, ticketId: string, input: { body?: unknown; photoKeys?: unknown; reopen?: unknown }) {
  const t = await ctx.tx.ticket.findUnique({ where: { id: ticketId }, include: { retailer: { select: { outletName: true } } } });
  if (!t || t.retailerId !== retailerId) throw fail("Complaint not found", 404);
  if (t.status === "CLOSED") throw fail("This complaint is closed. Raise a new one if the problem is back.", 409);
  const body = text(input.body, 2000);
  if (!body) throw fail("Write your message");
  const reopen = t.status === "RESOLVED";
  if (reopen && input.reopen !== true) throw fail("This complaint is resolved. Reopen it to add more.", 409);
  const next: TicketStatus | null = reopen || t.status === "WAITING" ? "IN_PROGRESS" : null;
  await ctx.tx.ticketMessage.create({ data: { ticketId: t.id, authorId: by, body, photoKeys: keys(input.photoKeys, 4, ctx.tenantId), change: next ? `${t.status}>${next}` : null } });
  const updated = next ? await ctx.tx.ticket.update({ where: { id: t.id }, data: { status: next, resolvedAt: reopen ? null : undefined } }) : t;
  const to = t.assignedToId ? [t.assignedToId] : await staffWith(ctx.tx, "tickets.manage");
  await notify(ctx.tx, ctx.tenantId, {
    event: "staff.ticket_reply",
    to,
    key: `staff.ticket_reply:${t.id}:${Date.now()}`,
    link: `/admin/complaints/${t.id}`,
    vars: { ticket: t.number, outlet: t.retailer.outletName },
  });
  return updated;
}

/** Every 15 minutes: tell the office once about complaints past their SLA. */
export async function slaSweep(tx: Tx, tenantId: string, now = new Date()) {
  const late = await tx.ticket.findMany({
    where: { status: { in: ["OPEN", "IN_PROGRESS", "WAITING"] }, slaDueAt: { lt: now }, slaNotifiedAt: null },
    select: { id: true, number: true, assignedToId: true, retailer: { select: { outletName: true } } },
    take: 200,
  });
  const managers = late.length ? await staffWith(tx, "tickets.manage") : [];
  for (const t of late) {
    await notify(tx, tenantId, {
      event: "staff.ticket_sla",
      to: t.assignedToId ? [t.assignedToId, ...managers] : managers,
      key: `staff.ticket_sla:${t.id}`,
      link: `/admin/complaints/${t.id}`,
      vars: { ticket: t.number, outlet: t.retailer.outletName },
    });
    await tx.ticket.update({ where: { id: t.id }, data: { slaNotifiedAt: now } });
  }
  return late.length;
}

/** Daily: resolved complaints the retailer did not reopen close by themselves. */
export async function autoClose(tx: Tx, tenantId: string, now = new Date()) {
  const s = await settings(tx, tenantId);
  const before = new Date(now.getTime() - s.autoCloseDays * 24 * 3600_000);
  const rows = await tx.ticket.findMany({ where: { status: "RESOLVED", resolvedAt: { lt: before } }, select: { id: true, createdById: true } });
  for (const r of rows) {
    await tx.ticket.update({ where: { id: r.id }, data: { status: "CLOSED", closedAt: now } });
    await tx.ticketMessage.create({ data: { ticketId: r.id, authorId: r.createdById, body: "", change: "RESOLVED>CLOSED", internal: false } });
  }
  return rows.length;
}

/** Is it past its SLA right now? */
export const overdue = (t: { status: TicketStatus; slaDueAt: Date }, now = new Date()) =>
  ["OPEN", "IN_PROGRESS", "WAITING"].includes(t.status) && t.slaDueAt < now;

// ───────────────────────────── delivery rating ─────────────────────────────

export async function rateDelivery(ctx: Ctx, retailerId: string, input: { orderId: unknown; rating: unknown; tags?: unknown; comment?: unknown }, now = new Date()) {
  if (typeof input.orderId !== "string") throw fail("Pick the order");
  const rating = Number(input.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw fail("Pick 1 to 5 stars");
  const o = await ctx.tx.order.findUnique({
    where: { id: input.orderId },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      updatedAt: true,
      retailerId: true,
      retailer: { select: { outletName: true } },
      delivery: { select: { deliveredAt: true, deliveryAgent: { select: { user: { select: { id: true, name: true } } } } } },
    },
  });
  if (!o || o.retailerId !== retailerId) throw fail("Order not found", 404);
  if (o.status !== "DELIVERED") throw fail("You can rate an order once it is delivered", 409);
  const s = await settings(ctx.tx, ctx.tenantId);
  // No delivery record (marked delivered by the office): the last change to the order is the best guess.
  const at = o.delivery?.deliveredAt ?? o.updatedAt;
  if (now.getTime() - at.getTime() > s.feedbackDays * 24 * 3600_000) throw fail(`Deliveries can be rated for ${s.feedbackDays} days`, 409);
  if (await ctx.tx.deliveryFeedback.findUnique({ where: { orderId: o.id }, select: { id: true } })) throw fail("You already rated this delivery", 409);
  const tags = Array.isArray(input.tags) ? [...new Set(input.tags.filter((t): t is FeedbackTag => typeof t === "string" && t in FEEDBACK_TAGS))] : [];
  const driver = o.delivery?.deliveryAgent.user ?? null;
  const fb = await ctx.tx.deliveryFeedback.create({
    data: { orderId: o.id, retailerId, driverUserId: driver?.id ?? null, rating, tags, comment: text(input.comment, 500) || null },
  });
  if (rating <= s.lowRating) {
    await notify(ctx.tx, ctx.tenantId, {
      event: "staff.feedback_low",
      to: await staffWith(ctx.tx, "tickets.manage"),
      key: `staff.feedback_low:${o.id}`,
      link: "/admin/engage/ratings",
      vars: { outlet: o.retailer.outletName, rating, order: o.orderNumber, driver: driver?.name ?? "the driver" },
    });
  }
  return fb;
}

/** Feedback summary for the office: average, count and per driver. */
export async function feedbackSummary(tx: Tx, from: Date, to: Date) {
  const rows = await tx.deliveryFeedback.findMany({
    where: { createdAt: { gte: from, lt: to } },
    orderBy: { createdAt: "desc" },
    select: { id: true, rating: true, tags: true, comment: true, createdAt: true, driverUserId: true, order: { select: { id: true, orderNumber: true, totalAmount: true } }, retailer: { select: { id: true, outletName: true } } },
    take: 500,
  });
  const drivers = await tx.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.driverUserId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } });
  const by = new Map<string, { userId: string; name: string; count: number; sum: number }>();
  for (const r of rows) {
    if (!r.driverUserId) continue;
    const d = by.get(r.driverUserId) ?? { userId: r.driverUserId, name: drivers.find((x) => x.id === r.driverUserId)?.name ?? "", count: 0, sum: 0 };
    d.count++;
    d.sum += r.rating;
    by.set(r.driverUserId, d);
  }
  const tagCount: Record<string, number> = {};
  for (const r of rows) for (const t of r.tags) tagCount[t] = (tagCount[t] ?? 0) + 1;
  const total = rows.reduce((s, r) => s + r.rating, 0);
  return {
    count: rows.length,
    average: rows.length ? Math.round((total / rows.length) * 10) / 10 : null,
    stars: [1, 2, 3, 4, 5].map((n) => rows.filter((r) => r.rating === n).length),
    tags: tagCount,
    drivers: [...by.values()].map((d) => ({ userId: d.userId, name: d.name, count: d.count, average: Math.round((d.sum / d.count) * 10) / 10 })).sort((a, b) => a.average - b.average),
    rows: rows.map((r) => ({ ...r, value: formatINR(r.order.totalAmount) })),
  };
}
