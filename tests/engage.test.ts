/**
 * Phase 7 against the real database: the notification centre (in-app rows,
 * the outbox per channel, dedupe, mutes, Hindi and the business's own wording),
 * sending without a provider, complaints with SLA and status rules, delivery
 * ratings, refer & earn with its ledger rewards, announcements by area, the
 * staff alerts for new shops and leave, and tenant isolation of the new tables.
 *
 * Fresh users in the demo tenant; settings restored afterwards.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from "vitest";
import webpush from "web-push";
import { prisma } from "@/lib/prisma";
import { tenantDb, withTenantTx } from "@/lib/db";
import { balanceOf, withMoney } from "@/lib/ledger";
import { placeOrder } from "@/lib/order-place";
import { CART_DEFAULTS } from "@/lib/cart-settings";
import { notify, staffWith } from "@/lib/notify";
import { flushTenant, waNumber, whatsappBody } from "@/lib/outbox";
import { checkTemplate, placeholders, render } from "@/lib/notify-events";
import { eventOn, notifySettings, parseNotifySettings, parseReferralSettings, parseSupportSettings, REFERRAL_DEFAULTS } from "@/lib/engage-settings";
import { autoClose, officeReply, overdue, raiseTicket, rateDelivery, retailerReply, slaSweep } from "@/lib/tickets";
import { attachReferral, lapseReferrals, lookupCode, makeCode, normaliseCode, qualifyReferral, referralCodeFor } from "@/lib/referrals";
import { audienceOf, liveFor, publishAnnouncement, saveAnnouncement } from "@/lib/announcements";
import { proposeLead, requestLeave } from "@/lib/field";
import { sendStatement } from "@/lib/notify-flows";
import { can } from "@/lib/permissions";

const run = Date.now().toString().slice(-6);
const phone = (n: number) => `6${run}${String(n).padStart(3, "0")}`;
let T = "";
let T2 = "";
let original: unknown = null;
let adminId = "";
let areaId = "";
let otherAreaId = "";
let productId = "";
const shop = { a: "", b: "", c: "", d: "", e: "" };
const user = { a: "", b: "", c: "", d: "", e: "", agent: "", sup: "" };
const HOUR = 3600_000;
const DAY = 24 * HOUR;

const as = <X>(who: string, fn: Parameters<typeof withMoney<X>>[2]) => withMoney(T, who, fn);

async function patchSettings(patch: Record<string, unknown>) {
  const t = await prisma.tenant.findUniqueOrThrow({ where: { id: T }, select: { settings: true } });
  await prisma.tenant.update({ where: { id: T }, data: { settings: { ...(t.settings as object), ...patch } as object } });
}

async function mkShop(n: number, area: string, extra: { lang?: string; gstin?: string } = {}) {
  const r = await tenantDb(T).user.create({
    data: {
      name: `Engage shop ${run}-${n}`,
      phone: phone(n),
      role: "RETAILER",
      lang: extra.lang ?? "en",
      retailerProfile: {
        create: { outletName: `Engage shop ${run}-${n}`, shopNumber: "1", complexName: "Test", pinCode: "400001", areaId: area, gstin: extra.gstin ?? null, paymentMode: "POSTPAID", creditLimit: null },
      },
    },
    include: { retailerProfile: true },
  });
  return { userId: r.id, shopId: r.retailerProfile!.id };
}

/** An order of `qty` units, then marked delivered (the delivery flow itself is tested in delivery.test.ts). */
async function deliveredOrder(shopId: string, userId: string, qty = 2) {
  const { order } = await as(userId, (ctx) => placeOrder(ctx, { retailerId: shopId, placedById: userId, items: [{ productId, quantity: qty }] }));
  await tenantDb(T).order.update({ where: { id: order.id }, data: { status: "DELIVERED" } });
  return tenantDb(T).order.findUniqueOrThrow({ where: { id: order.id } });
}

const notes = (userId: string, event?: string) => tenantDb(T).notification.findMany({ where: { userId, ...(event ? { event } : {}) }, orderBy: { createdAt: "asc" } });
const logs = (userId: string, event?: string) => tenantDb(T).messageLog.findMany({ where: { userId, ...(event ? { event } : {}) }, orderBy: { createdAt: "asc" } });

beforeAll(async () => {
  const demo = await prisma.tenant.findUniqueOrThrow({ where: { slug: "demo" }, select: { id: true, settings: true } });
  T = demo.id;
  original = demo.settings;
  T2 = (await prisma.tenant.findUniqueOrThrow({ where: { slug: "second" }, select: { id: true } })).id;
  const db = tenantDb(T);
  adminId = (await db.user.findFirstOrThrow({ where: { role: "ADMIN", active: true } })).id;
  const areas = await db.area.findMany({ take: 2, orderBy: { name: "asc" } });
  areaId = areas[0].id;
  otherAreaId = (areas[1] ?? (await db.area.create({ data: { name: `Engage area ${run}`, regionId: areas[0].regionId } }))).id;
  productId = (await db.product.findFirstOrThrow({ where: { active: true, sku: "BEV-001" } })).id;
  for (const [k, n, area, extra] of [
    ["a", 1, areaId, { gstin: undefined }],
    ["b", 2, areaId, {}],
    ["c", 3, otherAreaId, { lang: "hi" }],
    ["d", 4, areaId, {}],
    ["e", 5, areaId, {}],
  ] as const) {
    const s = await mkShop(n, area, extra);
    shop[k] = s.shopId;
    user[k] = s.userId;
  }
  user.sup = (await db.user.create({ data: { name: `Engage sup ${run}`, phone: phone(20), role: "SUPERVISOR" } })).id;
  user.agent = (await db.user.create({ data: { name: `Engage agent ${run}`, phone: phone(21), role: "SALES_AGENT", supervisorId: user.sup, salesAgentProfile: { create: {} } } })).id;
  await patchSettings({
    cart: { ...CART_DEFAULTS, minOrderValue: 0, deliveryCharge: 0, freeDeliveryAbove: 0, closedWeekdays: [], holidays: [], cutoffTime: "23:59" },
    notify: { channels: { push: true, whatsapp: true, sms: false }, events: {}, reminders: { on: true, days: [1, 7, 15] }, monthlyStatement: false },
    support: { slaHours: {}, autoCloseDays: 3, feedbackDays: 7, lowRating: 2 },
    referral: { ...REFERRAL_DEFAULTS, on: false },
  });
});

afterAll(async () => {
  if (T) {
    await prisma.tenant.update({ where: { id: T }, data: { settings: original as object } });
    await tenantDb(T).messageTemplate.deleteMany({ where: { event: "order.placed", waTemplate: `t_${run}` } });
    await tenantDb(T).user.updateMany({ where: { id: { in: Object.values(user).filter(Boolean) } }, data: { active: false } });
  }
});

describe("wording and payloads", () => {
  it("fills placeholders and leaves unknown ones visible", () => {
    expect(placeholders("Hi {outlet}, {amount} due. {outlet}")).toEqual(["outlet", "amount"]);
    expect(render("Hi {outlet}, {amount} due", { outlet: "Shree", amount: "₹10" })).toBe("Hi Shree, ₹10 due");
    expect(render("Hi {nobody}", {})).toContain("Hi");
  });

  it("rejects a template that uses a placeholder the event does not have", () => {
    expect(checkTemplate("order.placed", "Order {order}", "Thanks {outlet}")).toBeNull();
    expect(checkTemplate("order.placed", "Order {order}", "Your {password}")).toMatch(/password/);
  });

  it("builds a WhatsApp template body with the invoice as a document header", () => {
    const b = whatsappBody({ to: "9876543210", lang: "hi", waTemplate: "invoice_v1", params: ["Shree", "", "₹1,000"], docUrl: "https://x/i.pdf", event: "invoice.issued" });
    expect(b.to).toBe("919876543210");
    expect(b.template.name).toBe("invoice_v1");
    expect(b.template.language.code).toBe("hi");
    const [header, body] = b.template.components as { type: string; parameters: { text?: string; document?: { link: string } }[] }[];
    expect(header.type).toBe("header");
    expect(header.parameters[0].document?.link).toBe("https://x/i.pdf");
    expect(body.parameters.map((p) => p.text)).toEqual(["Shree", "-", "₹1,000"]);
    expect(waNumber("+91 98765-43210")).toBe("919876543210");
  });

  it("per-event overrides beat the event's default channels, but never a channel the business turned off", () => {
    const s = notifySettings({ notify: { channels: { push: true, whatsapp: true, sms: false }, events: { "order.placed": { whatsapp: false }, "statement": { sms: true } } } });
    expect(eventOn(s, "order.placed", "whatsapp")).toBe(false);
    expect(eventOn(s, "order.placed", "push")).toBe(true);
    expect(eventOn(s, "statement", "sms")).toBe(false);
  });

  it("validates the settings sections", () => {
    expect(typeof parseNotifySettings({ reminders: { on: true, days: [121] } })).toBe("string");
    expect(typeof parseSupportSettings({ autoCloseDays: -1 })).toBe("string");
    expect(typeof parseReferralSettings({ referrerReward: -5 })).toBe("string");
    expect(parseReferralSettings({ on: true, referrerReward: 10_000 })).toMatchObject({ on: true, referrerReward: 10_000 });
  });
});

describe("notification centre", () => {
  it("writes one in-app row and one WhatsApp outbox row, and never twice for the same key", async () => {
    const key = `order.placed:test-${run}`;
    const vars = { order: "ORD-X", outlet: "Shop A", amount: "₹500", items: 2, date: "today" };
    await as(adminId, (ctx) => notify(ctx.tx, ctx.tenantId, { event: "order.placed", to: [user.a], vars, key, link: "/retailer/orders" }));
    await as(adminId, (ctx) => notify(ctx.tx, ctx.tenantId, { event: "order.placed", to: [user.a], vars, key, link: "/retailer/orders" }));
    const n = await notes(user.a, "order.placed");
    expect(n).toHaveLength(1);
    expect(n[0].body).toContain("Shop A");
    const m = await logs(user.a, "order.placed");
    expect(m.map((x) => x.channel)).toEqual(["WHATSAPP"]); // no push device, SMS off
    expect(m[0]).toMatchObject({ status: "QUEUED", to: phone(1), lang: "en" });
    expect(Array.isArray(m[0].params)).toBe(true);
  });

  it("sends Hindi wording to a Hindi user, and uses the business's own wording and WhatsApp template", async () => {
    await tenantDb(T).messageTemplate.create({ data: { event: "order.placed", lang: "hi", title: "ऑर्डर {order}", body: "धन्यवाद {outlet}", waTemplate: `t_${run}` } });
    await as(adminId, (ctx) => notify(ctx.tx, ctx.tenantId, { event: "order.placed", to: [user.c], vars: { order: "ORD-H", outlet: "दुकान" }, key: `hi-${run}` }));
    const [n] = await notes(user.c, "order.placed");
    expect(n.title).toBe("ऑर्डर ORD-H");
    expect(n.body).toBe("धन्यवाद दुकान");
    const [m] = await logs(user.c, "order.placed");
    expect(m).toMatchObject({ lang: "hi", waTemplate: `t_${run}`, params: ["दुकान"] });
  });

  it("skips a channel the person muted, but still shows it in the app", async () => {
    await tenantDb(T).user.update({ where: { id: user.d }, data: { mutes: ["whatsapp"] } });
    await as(adminId, (ctx) => notify(ctx.tx, ctx.tenantId, { event: "order.placed", to: [user.d], vars: { order: "M" }, key: `mute-${run}` }));
    expect(await notes(user.d, "order.placed")).toHaveLength(1);
    expect(await logs(user.d, "order.placed")).toHaveLength(0);
    await tenantDb(T).user.update({ where: { id: user.d }, data: { mutes: [] } });
  });

  it("muting a topic stops reminders on every channel", async () => {
    await tenantDb(T).user.update({ where: { id: user.d }, data: { mutes: ["reminders"] } });
    await as(adminId, (ctx) => notify(ctx.tx, ctx.tenantId, { event: "dues.reminder", to: [user.d], vars: { amount: "₹1" }, key: `topic-${run}` }));
    expect(await notes(user.d, "dues.reminder")).toHaveLength(1);
    expect(await logs(user.d, "dues.reminder")).toHaveLength(0);
    await tenantDb(T).user.update({ where: { id: user.d }, data: { mutes: [] } });
  });

  it("staff alerts go by push only, and only to people with a device", async () => {
    await as(adminId, (ctx) => notify(ctx.tx, ctx.tenantId, { event: "staff.order", to: [user.sup], vars: { order: "S1" }, key: `staff1-${run}` }));
    expect(await logs(user.sup)).toHaveLength(0);
    await tenantDb(T).pushSubscription.create({ data: { userId: user.sup, endpoint: `https://push.invalid/${run}`, p256dh: "bad", auth: "bad" } });
    await as(adminId, (ctx) => notify(ctx.tx, ctx.tenantId, { event: "staff.order", to: [user.sup], vars: { order: "S2" }, key: `staff2-${run}` }));
    const m = await logs(user.sup);
    expect(m.map((x) => x.channel)).toEqual(["PUSH"]);
  });

  it("without a provider WhatsApp is kept as LOGGED; a broken push device fails and is retried at most 3 times", async () => {
    // Push needs a key pair; CI has none in its environment, so make a throwaway one.
    const saved = { pub: process.env.VAPID_PUBLIC_KEY, priv: process.env.VAPID_PRIVATE_KEY };
    if (!saved.pub || !saved.priv) {
      const keys = webpush.generateVAPIDKeys();
      process.env.VAPID_PUBLIC_KEY = keys.publicKey;
      process.env.VAPID_PRIVATE_KEY = keys.privateKey;
    }
    onTestFinished(() => {
      process.env.VAPID_PUBLIC_KEY = saved.pub;
      process.env.VAPID_PRIVATE_KEY = saved.priv;
    });
    await flushTenant(T, 500);
    const wa = (await logs(user.a, "order.placed"))[0];
    expect(wa.status).toBe("LOGGED");
    const push = (await logs(user.sup)).find((x) => x.channel === "PUSH")!;
    expect(push.status).toBe("FAILED");
    expect(push.attempts).toBe(1);
    // A retry only happens after 5 minutes.
    await flushTenant(T, 500);
    expect((await tenantDb(T).messageLog.findUniqueOrThrow({ where: { id: push.id } })).attempts).toBe(1);
    await flushTenant(T, 500, new Date(Date.now() + 6 * 60_000));
    expect((await tenantDb(T).messageLog.findUniqueOrThrow({ where: { id: push.id } })).attempts).toBe(2);
  });

  it("skips inactive people", async () => {
    const r = await as(adminId, (ctx) => notify(ctx.tx, ctx.tenantId, { event: "order.placed", to: ["nobody-" + run], vars: {} }));
    expect(r).toEqual({ inApp: 0, messages: 0 });
  });

  it("statement button: the retailer gets their balance and khata link", async () => {
    const ok = await as(adminId, (ctx) => sendStatement(ctx.tx, ctx.tenantId, shop.b, `statement:${shop.b}:${run}`));
    expect(ok).toBe(true);
    const [n] = await notes(user.b, "statement");
    expect(n.link).toBe("/retailer/khata");
    expect((await logs(user.b, "statement"))[0].body).toMatch(/http:\/\/demo\./);
  });

  it("new shops from the field and leave requests alert the right staff", async () => {
    const lead = await as(user.agent, (ctx) =>
      proposeLead(ctx, { userId: user.agent, role: "SALES_AGENT" }, { outletName: `Lead ${run}`, ownerName: "Owner", phone: phone(30), shopNumber: "2", complexName: "Mkt", pinCode: "400002", areaId })
    );
    const approvers = await as(adminId, (ctx) => staffWith(ctx.tx, "stores.approve"));
    expect(approvers).toContain(adminId);
    expect(await tenantDb(T).notification.count({ where: { dedupeKey: `staff.lead:${lead.id}:${adminId}` } })).toBe(1);
    const leave = await as(user.agent, (ctx) => requestLeave(ctx, user.agent, { fromDate: "2027-01-04", toDate: "2027-01-05", type: "casual" }));
    expect(await tenantDb(T).notification.count({ where: { dedupeKey: `staff.leave:${leave.id}:${user.sup}` } })).toBe(1);
    expect(await tenantDb(T).notification.count({ where: { dedupeKey: `staff.leave:${leave.id}:${user.agent}` } })).toBe(0);
  });
});

describe("complaints", () => {
  let orderId = "";
  let ticketId = "";

  beforeAll(async () => {
    orderId = (await deliveredOrder(shop.a, user.a, 1)).id;
  });

  it("raises with a number, an SLA from the category and high priority for damaged goods", async () => {
    const now = new Date();
    const t = await as(user.a, (ctx) =>
      raiseTicket(ctx, user.a, { retailerId: shop.a, orderId, category: "damaged", subject: "", body: "Two bottles broken", photoKeys: [`t/${T}/ticket-photo/2026/11/a.jpg`, "t/other/ticket-photo/x.jpg", "../../etc"] }, now)
    );
    ticketId = t.id;
    expect(t.number).toMatch(/^TKT\d{2}-?\d{2}-\d{5}$|^TKT.+-\d{5}$/);
    expect(t.priority).toBe("high");
    expect(t.createdAt.getTime()).toBe(now.getTime());
    expect(t.subject).toMatch(/damaged/i);
    expect(Math.round((t.slaDueAt.getTime() - now.getTime()) / HOUR)).toBe(24);
    const [msg] = await tenantDb(T).ticketMessage.findMany({ where: { ticketId } });
    expect(msg.photoKeys).toEqual([`t/${T}/ticket-photo/2026/11/a.jpg`]);
    expect(await tenantDb(T).notification.count({ where: { dedupeKey: `staff.ticket:${ticketId}:${adminId}` } })).toBe(1);
  });

  it("refuses a second open complaint of the same kind for the same order, and another shop's order", async () => {
    await expect(as(user.a, (ctx) => raiseTicket(ctx, user.a, { retailerId: shop.a, orderId, category: "damaged", subject: "", body: "Again broken" }))).rejects.toThrow(/already open/);
    await expect(as(user.b, (ctx) => raiseTicket(ctx, user.b, { retailerId: shop.b, orderId, category: "missing", subject: "", body: "Not mine" }))).rejects.toThrow(/not this shop/);
    await expect(as(user.a, (ctx) => raiseTicket(ctx, user.a, { retailerId: shop.a, category: "nonsense", subject: "", body: "Hello there" }))).rejects.toThrow(/Pick/);
  });

  it("an internal note does not tell the retailer; a reply starts work and records the first response", async () => {
    await as(adminId, (ctx) => officeReply(ctx, adminId, ticketId, { body: "Check with driver", internal: true }));
    let t = await tenantDb(T).ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(t.status).toBe("OPEN");
    expect(t.firstResponseAt).toBeNull();
    expect(await notes(user.a, "ticket.update")).toHaveLength(0);
    await as(adminId, (ctx) => officeReply(ctx, adminId, ticketId, { body: "Sorry, we are checking", assignedToId: adminId }));
    t = await tenantDb(T).ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(t.status).toBe("IN_PROGRESS");
    expect(t.assignedToId).toBe(adminId);
    expect(t.firstResponseAt).not.toBeNull();
    expect(await notes(user.a, "ticket.update")).toHaveLength(1);
  });

  it("enforces the status rules", async () => {
    await expect(as(adminId, (ctx) => officeReply(ctx, adminId, ticketId, { status: "OPEN" }))).rejects.toThrow(/can't move/);
    await expect(as(adminId, (ctx) => officeReply(ctx, adminId, ticketId, { status: "RESOLVED" }))).rejects.toThrow(/how it was resolved/);
    await expect(as(adminId, (ctx) => officeReply(ctx, adminId, ticketId, { status: "RESOLVED", body: "Fixed", internal: true }))).rejects.toThrow(/retailer can see/);
    await expect(as(adminId, (ctx) => officeReply(ctx, adminId, ticketId, { status: "WAITING", body: "x", internal: true }))).rejects.toThrow(/can see/);
    await expect(as(adminId, (ctx) => officeReply(ctx, adminId, ticketId, { assignedToId: user.a }))).rejects.toThrow(/handles complaints/);
    await as(adminId, (ctx) => officeReply(ctx, adminId, ticketId, { status: "WAITING", body: "Can you send a photo of the crate?" }));
    await as(user.a, (ctx) => retailerReply(ctx, user.a, shop.a, ticketId, { body: "Sent above" }));
    expect((await tenantDb(T).ticket.findUniqueOrThrow({ where: { id: ticketId } })).status).toBe("IN_PROGRESS");
  });

  it("a resolved complaint can be reopened by the retailer, and closes by itself after the set days", async () => {
    const now = Date.now();
    await as(adminId, (ctx) => officeReply(ctx, adminId, ticketId, { status: "RESOLVED", body: "Credit note issued" }, new Date(now)));
    await expect(as(user.a, (ctx) => retailerReply(ctx, user.a, shop.a, ticketId, { body: "Not received" }))).rejects.toThrow(/Reopen/);
    await as(user.a, (ctx) => retailerReply(ctx, user.a, shop.a, ticketId, { body: "Not received", reopen: true }));
    let t = await tenantDb(T).ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(t.status).toBe("IN_PROGRESS");
    expect(t.resolvedAt).toBeNull();
    await as(adminId, (ctx) => officeReply(ctx, adminId, ticketId, { status: "RESOLVED", body: "Now issued" }, new Date(now)));
    await as(adminId, (ctx) => autoClose(ctx.tx, ctx.tenantId, new Date(now + 2 * DAY)));
    expect((await tenantDb(T).ticket.findUniqueOrThrow({ where: { id: ticketId } })).status).toBe("RESOLVED");
    await as(adminId, (ctx) => autoClose(ctx.tx, ctx.tenantId, new Date(now + 4 * DAY)));
    t = await tenantDb(T).ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(t.status).toBe("CLOSED");
    await expect(as(user.a, (ctx) => retailerReply(ctx, user.a, shop.a, ticketId, { body: "Hello", reopen: true }))).rejects.toThrow(/closed/);
    await expect(as(adminId, (ctx) => officeReply(ctx, adminId, ticketId, { body: "Hello" }))).rejects.toThrow(/closed/);
  });

  it("someone else's complaint is not found", async () => {
    await expect(as(user.b, (ctx) => retailerReply(ctx, user.b, shop.b, ticketId, { body: "Me too" }))).rejects.toThrow(/not found/);
  });

  it("tells the office once when a complaint is past its SLA", async () => {
    const t = await as(user.b, (ctx) => raiseTicket(ctx, user.b, { retailerId: shop.b, category: "billing", subject: "Wrong rate", body: "Charged more than the list" }));
    const later = new Date(t.slaDueAt.getTime() + HOUR);
    expect(overdue(t, later)).toBe(true);
    expect(await as(adminId, (ctx) => slaSweep(ctx.tx, ctx.tenantId, later))).toBeGreaterThanOrEqual(1);
    expect(await as(adminId, (ctx) => slaSweep(ctx.tx, ctx.tenantId, later))).toBe(0);
    expect(await tenantDb(T).notification.count({ where: { dedupeKey: `staff.ticket_sla:${t.id}:${adminId}` } })).toBe(1);
  });
});

describe("delivery rating", () => {
  it("only delivered orders, once, within the window; low ratings alert the office", async () => {
    const { order } = await as(user.e, (ctx) => placeOrder(ctx, { retailerId: shop.e, placedById: user.e, items: [{ productId, quantity: 1 }] }));
    await expect(as(user.e, (ctx) => rateDelivery(ctx, shop.e, { orderId: order.id, rating: 5 }))).rejects.toThrow(/once it is delivered/);
    await tenantDb(T).order.update({ where: { id: order.id }, data: { status: "DELIVERED" } });
    await expect(as(user.e, (ctx) => rateDelivery(ctx, shop.e, { orderId: order.id, rating: 9 }))).rejects.toThrow(/1 to 5/);
    await expect(as(user.b, (ctx) => rateDelivery(ctx, shop.b, { orderId: order.id, rating: 4 }))).rejects.toThrow(/not found/);
    const fb = await as(user.e, (ctx) => rateDelivery(ctx, shop.e, { orderId: order.id, rating: 2, tags: ["late", "bogus"], comment: "Came at 9 pm" }));
    expect(fb.tags).toEqual(["late"]);
    expect(await tenantDb(T).notification.count({ where: { dedupeKey: `staff.feedback_low:${order.id}:${adminId}` } })).toBe(1);
    await expect(as(user.e, (ctx) => rateDelivery(ctx, shop.e, { orderId: order.id, rating: 5 }))).rejects.toThrow(/already rated/);
    const late = new Date(Date.now() + 8 * DAY);
    const o2 = await deliveredOrder(shop.e, user.e, 1);
    await expect(as(user.e, (ctx) => rateDelivery(ctx, shop.e, { orderId: o2.id, rating: 5 }, late))).rejects.toThrow(/7 days/);
  });
});

describe("refer and earn", () => {
  it("makes readable codes", () => {
    const c = makeCode("Om Sai Kirana");
    expect(c).toMatch(/^[A-Z]{3}[A-Z2-9]{4}$/);
    expect(c).not.toMatch(/[01OIL]/);
    expect(normaliseCode(" msk-ab 12 ")).toBe("MSKAB12");
  });

  it("codes don't work while the feature is off", async () => {
    const code = await as(adminId, (ctx) => referralCodeFor(ctx.tx, shop.a));
    expect(await as(adminId, (ctx) => referralCodeFor(ctx.tx, shop.a))).toBe(code);
    await expect(as(adminId, (ctx) => lookupCode(ctx.tx, ctx.tenantId, code))).rejects.toThrow(/not on/);
  });

  it("pays both shops once, on the referred shop's first delivered order above the minimum", async () => {
    await patchSettings({ referral: { ...REFERRAL_DEFAULTS, on: true, referrerReward: 20_000, refereeReward: 5_000, minOrder: 1, validDays: 60, monthlyCap: 10 } });
    const code = await as(adminId, (ctx) => referralCodeFor(ctx.tx, shop.a));
    expect((await as(adminId, (ctx) => lookupCode(ctx.tx, ctx.tenantId, code.toLowerCase()))).referrerId).toBe(shop.a);
    await expect(as(adminId, (ctx) => attachReferral(ctx.tx, ctx.tenantId, shop.a, code))).rejects.toThrow(/own code/);
    await expect(as(adminId, (ctx) => lookupCode(ctx.tx, ctx.tenantId, "ZZZZ9999"))).rejects.toThrow(/not valid/);
    await as(adminId, (ctx) => attachReferral(ctx.tx, ctx.tenantId, shop.b, code));
    const before = { a: await as(adminId, (ctx) => balanceOf(ctx, { type: "WALLET", retailerId: shop.a })), b: await as(adminId, (ctx) => balanceOf(ctx, { type: "WALLET", retailerId: shop.b })) };
    const o = await deliveredOrder(shop.b, user.b, 1);
    expect(await as(adminId, (ctx) => qualifyReferral(ctx, o.id))).toBe("rewarded");
    expect(await as(adminId, (ctx) => qualifyReferral(ctx, o.id))).toBe("no pending referral");
    // WALLET is negative when we hold the shop's money.
    expect(await as(adminId, (ctx) => balanceOf(ctx, { type: "WALLET", retailerId: shop.a }))).toBe(before.a - 20_000);
    expect(await as(adminId, (ctx) => balanceOf(ctx, { type: "WALLET", retailerId: shop.b }))).toBe(before.b - 5_000);
    const r = await tenantDb(T).referral.findUniqueOrThrow({ where: { refereeId: shop.b } });
    expect(r).toMatchObject({ status: "REWARDED", orderId: o.id });
    expect(await notes(user.a, "referral.reward")).toHaveLength(1);
    expect(await notes(user.b, "referral.reward")).toHaveLength(1);
    const entries = await tenantDb(T).journalEntry.findMany({ where: { kind: "REWARD", retailerId: { in: [shop.a, shop.b] } }, include: { lines: true } });
    expect(entries).toHaveLength(2);
    for (const e of entries) expect(e.lines.reduce((s, l) => s + l.amount, 0)).toBe(0);
    await expect(as(adminId, (ctx) => attachReferral(ctx.tx, ctx.tenantId, shop.b, code))).rejects.toThrow();
  });

  it("lapses when the first order is below the minimum, or after the offer ends", async () => {
    const code = await as(adminId, (ctx) => referralCodeFor(ctx.tx, shop.a));
    await patchSettings({ referral: { ...REFERRAL_DEFAULTS, on: true, minOrder: 100_000_000, validDays: 60 } });
    await as(adminId, (ctx) => attachReferral(ctx.tx, ctx.tenantId, shop.d, code));
    const o = await deliveredOrder(shop.d, user.d, 1);
    expect(await as(adminId, (ctx) => qualifyReferral(ctx, o.id))).toBe("below minimum");
    expect((await tenantDb(T).referral.findUniqueOrThrow({ where: { refereeId: shop.d } })).status).toBe("LAPSED");
    await patchSettings({ referral: { ...REFERRAL_DEFAULTS, on: true, minOrder: 1, validDays: 1 } });
    await as(adminId, (ctx) => attachReferral(ctx.tx, ctx.tenantId, shop.c, code));
    expect(await as(adminId, (ctx) => lapseReferrals(ctx.tx, new Date(Date.now() + 2 * DAY)))).toBeGreaterThanOrEqual(1);
    expect((await tenantDb(T).referral.findUniqueOrThrow({ where: { refereeId: shop.c } })).status).toBe("LAPSED");
  });

  it("respects the monthly cap for the referring shop", async () => {
    await patchSettings({ referral: { ...REFERRAL_DEFAULTS, on: true, minOrder: 1, monthlyCap: 1, refereeReward: 0 } });
    const code = await as(adminId, (ctx) => referralCodeFor(ctx.tx, shop.a));
    await as(adminId, (ctx) => attachReferral(ctx.tx, ctx.tenantId, shop.e, code));
    // Shop E already has delivered orders from the rating test → not its first.
    await tenantDb(T).order.updateMany({ where: { retailerId: shop.e }, data: { status: "CANCELLED" } });
    const o = await deliveredOrder(shop.e, user.e, 1);
    expect(await as(adminId, (ctx) => qualifyReferral(ctx, o.id))).toBe("rewarded");
    const r = await tenantDb(T).referral.findUniqueOrThrow({ where: { refereeId: shop.e } });
    expect(r.note).toMatch(/Monthly limit/);
    expect(await tenantDb(T).journalEntry.count({ where: { kind: "REWARD", retailerId: shop.a } })).toBe(1);
  });
});

describe("announcements", () => {
  it("drafts, counts the audience by area, sends once and shows on the right homes", async () => {
    await expect(as(adminId, (ctx) => saveAnnouncement(ctx, adminId, null, { title: "", body: "x" }))).rejects.toThrow(/title/);
    await expect(as(adminId, (ctx) => saveAnnouncement(ctx, adminId, null, { title: "x", body: "y", link: "https://evil" }))).rejects.toThrow(/page in this app/);
    const a = await as(adminId, (ctx) => saveAnnouncement(ctx, adminId, null, { title: `Diwali ${run}`, body: "10% off sweets", audience: "RETAILERS", areaIds: [otherAreaId], channels: ["push", "whatsapp", "fax"] }));
    expect(a.channels).toEqual(["push", "whatsapp"]);
    const who = await as(adminId, (ctx) => audienceOf(ctx.tx, a));
    expect(who).toContain(user.c);
    expect(who).not.toContain(user.a);
    expect(await as(adminId, (ctx) => liveFor(ctx.tx, { id: user.c, role: "RETAILER" }))).not.toContainEqual(expect.objectContaining({ id: a.id }));
    const sent = await as(adminId, (ctx) => publishAnnouncement(ctx, a.id));
    expect(sent.sentCount).toBeGreaterThanOrEqual(1);
    await expect(as(adminId, (ctx) => publishAnnouncement(ctx, a.id))).rejects.toThrow(/Already sent/);
    expect((await as(adminId, (ctx) => liveFor(ctx.tx, { id: user.c, role: "RETAILER" }))).map((x) => x.id)).toContain(a.id);
    expect((await as(adminId, (ctx) => liveFor(ctx.tx, { id: user.a, role: "RETAILER" }))).map((x) => x.id)).not.toContain(a.id);
    expect(await notes(user.c, "announcement")).toHaveLength(1);
    // After sending, the audience can't change but the text can.
    const edited = await as(adminId, (ctx) => saveAnnouncement(ctx, adminId, a.id, { title: `Diwali ${run}!`, body: "12% off", audience: "ALL", areaIds: [] }));
    expect(edited).toMatchObject({ title: `Diwali ${run}!`, audience: "RETAILERS", areaIds: [otherAreaId] });
  });

  it("staff announcements reach only the chosen roles, by push", async () => {
    const a = await as(adminId, (ctx) => saveAnnouncement(ctx, adminId, null, { title: `Meeting ${run}`, body: "Monday 9 am", audience: "STAFF", roles: ["SUPERVISOR"], channels: ["push", "sms"] }));
    const who = await as(adminId, (ctx) => audienceOf(ctx.tx, a));
    expect(who).toContain(user.sup);
    expect(who).not.toContain(user.agent);
    await as(adminId, (ctx) => publishAnnouncement(ctx, a.id));
    expect(await notes(user.sup, "staff.announcement")).toHaveLength(1);
    expect((await logs(user.sup, "staff.announcement")).map((m) => m.channel)).toEqual(["PUSH"]);
    expect((await as(adminId, (ctx) => liveFor(ctx.tx, { id: user.agent, role: "SALES_AGENT" }))).map((x) => x.id)).not.toContain(a.id);
  });
});

describe("who may do what, and tenant walls", () => {
  it("permissions", () => {
    expect(can("RETAILER", "tickets.raise")).toBe(true);
    expect(can("RETAILER", "tickets.manage")).toBe(false);
    expect(can("SALES_AGENT", "promotions.manage")).toBe(false);
    expect(can("ADMIN", ["tickets.manage", "messages.manage", "promotions.manage"])).toBe(true);
  });

  it("another business sees none of these rows", async () => {
    const counts = await withTenantTx(T2, async (tx) =>
      Promise.all([
        tx.notification.count({ where: { userId: { in: Object.values(user) } } }),
        tx.messageLog.count({ where: { userId: { in: Object.values(user) } } }),
        tx.ticket.count({ where: { retailerId: { in: Object.values(shop) } } }),
        tx.referral.count({ where: { referrerId: shop.a } }),
        tx.deliveryFeedback.count({ where: { retailerId: shop.e } }),
        tx.announcement.count({ where: { title: { contains: run } } }),
      ])
    );
    expect(counts).toEqual([0, 0, 0, 0, 0, 0]);
  });
});
