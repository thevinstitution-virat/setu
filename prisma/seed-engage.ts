/**
 * Phase 7 demo: messages on (push + WhatsApp; nothing leaves the machine
 * without a provider, so outside messages show as "logged"), one shop that
 * reads Hindi, complaints in each state (one past its SLA), a delivery
 * rating, refer & earn on with one paid and one waiting referral, the
 * business's own wording for one message, and announcements (live, draft,
 * staff). Names and numbers are made up.
 */
import type { Db } from "./seed";
import { withMoney } from "../src/lib/ledger";
import { REFERRAL_DEFAULTS, SUPPORT_DEFAULTS } from "../src/lib/engage-settings";
import { officeReply, raiseTicket, rateDelivery, retailerReply } from "../src/lib/tickets";
import { attachReferral, qualifyReferral, referralCodeFor } from "../src/lib/referrals";
import { publishAnnouncement, saveAnnouncement } from "../src/lib/announcements";
import { sendStatement } from "../src/lib/notify-flows";
import { flushTenant } from "../src/lib/outbox";
import { PrismaClient } from "../src/generated/prisma/client";

type Ids = {
  tenantId: string;
  adminId: string;
  salesUserId: string;
  /** Agarwal (has the delivered order), Patel, Sai Super Mart. */
  shops: { agarwal: string; patel: string; sai: string };
  deliveredOrderId: string;
  areas: string[];
};

const HOUR = 3600_000;
const DAY = 24 * HOUR;

export async function seedEngage(db: Db, prisma: PrismaClient, ids: Ids) {
  const { tenantId: T, adminId } = ids;
  const t = await prisma.tenant.findUniqueOrThrow({ where: { id: T }, select: { settings: true } });
  // minOrder 1 paisa while seeding so the demo referral pays on the seeded order; the real setting is put back below.
  const referral = { ...REFERRAL_DEFAULTS, on: true, referrerReward: 20_000, refereeReward: 5_000, minOrder: 200_000 };
  await prisma.tenant.update({
    where: { id: T },
    data: {
      settings: {
        ...(t.settings as object),
        notify: { channels: { push: true, whatsapp: true, sms: false }, events: {}, reminders: { on: true, days: [1, 7, 15] }, monthlyStatement: true },
        support: SUPPORT_DEFAULTS,
        referral: { ...referral, minOrder: 1 },
      },
    },
  });

  const shop = await db.retailerProfile.findMany({ where: { id: { in: Object.values(ids.shops) } }, select: { id: true, userId: true } });
  const userOf = (id: string) => shop.find((s) => s.id === id)!.userId;
  const as = <X>(who: string, fn: Parameters<typeof withMoney<X>>[2]) => withMoney(T, who, fn);

  // Sai Super Mart reads the app (and gets messages) in Hindi.
  await db.user.update({ where: { id: userOf(ids.shops.sai) }, data: { lang: "hi" } });

  // The business's own wording for the order confirmation, with its approved WhatsApp template name.
  await db.messageTemplate.create({
    data: {
      event: "order.placed",
      lang: "en",
      title: "Order {order} received",
      body: "Namaste {outlet}! We got your order {order} for {amount} ({items} items). Delivery {date}.",
      waTemplate: "order_confirm_v1",
    },
  });

  const delivered = await db.order.findUniqueOrThrow({ where: { id: ids.deliveredOrderId }, include: { delivery: true } });
  const deliveredAt = delivered.delivery?.deliveredAt ?? new Date();

  // ── refer & earn: Agarwal joined with Sai Super Mart's code; their first delivered order paid both.
  const saiCode = await as(adminId, (ctx) => referralCodeFor(ctx.tx, ids.shops.sai));
  await as(adminId, (ctx) => attachReferral(ctx.tx, ctx.tenantId, ids.shops.agarwal, saiCode, new Date(deliveredAt.getTime() - 5 * DAY)));
  await as(adminId, (ctx) => qualifyReferral(ctx, ids.deliveredOrderId, deliveredAt));
  // Patel joined with Agarwal's code and has not had a delivery yet.
  const agarwalCode = await as(adminId, (ctx) => referralCodeFor(ctx.tx, ids.shops.agarwal));
  await as(adminId, (ctx) => attachReferral(ctx.tx, ctx.tenantId, ids.shops.patel, agarwalCode));
  const t2 = await prisma.tenant.findUniqueOrThrow({ where: { id: T }, select: { settings: true } });
  await prisma.tenant.update({ where: { id: T }, data: { settings: { ...(t2.settings as object), referral } } });

  // ── delivery rating for the delivered order
  await as(userOf(ids.shops.agarwal), (ctx) =>
    rateDelivery(ctx, ids.shops.agarwal, { orderId: ids.deliveredOrderId, rating: 4, tags: ["on_time", "polite"], comment: "Good, but one carton was dented." }, new Date(deliveredAt.getTime() + HOUR))
  );

  // ── complaints
  const now = Date.now();
  const agarwal = userOf(ids.shops.agarwal);
  const damaged = await as(agarwal, (ctx) =>
    raiseTicket(ctx, agarwal, { retailerId: ids.shops.agarwal, orderId: ids.deliveredOrderId, category: "damaged", subject: "Dented carton", body: "One carton of the cold drinks came dented and two bottles leaked." }, new Date(now - 6 * HOUR))
  );
  await as(adminId, (ctx) => officeReply(ctx, adminId, damaged.id, { body: "Driver says the crate fell at loading. Check the CCTV.", internal: true }, new Date(now - 5 * HOUR)));
  await as(adminId, (ctx) => officeReply(ctx, adminId, damaged.id, { body: "Sorry about this. We will replace the two bottles with your next order.", assignedToId: adminId }, new Date(now - 4 * HOUR)));

  const patel = userOf(ids.shops.patel);
  // Raised 4 days ago with a 72-hour SLA, never answered → past its SLA.
  await as(patel, (ctx) =>
    raiseTicket(ctx, patel, { retailerId: ids.shops.patel, category: "billing", subject: "Rate on last bill", body: "The biscuits were billed at the old rate. Please check and correct." }, new Date(now - 4 * DAY))
  );
  const waiting = await as(patel, (ctx) =>
    raiseTicket(ctx, patel, { retailerId: ids.shops.patel, category: "late", subject: "Delivery came late", body: "Delivery came after the shop closed last week." }, new Date(now - 2 * DAY))
  );
  await as(adminId, (ctx) => officeReply(ctx, adminId, waiting.id, { status: "WAITING", body: "Which day was it? We will check the trip." }, new Date(now - DAY)));

  const sai = userOf(ids.shops.sai);
  const resolved = await as(sai, (ctx) =>
    raiseTicket(ctx, sai, { retailerId: ids.shops.sai, category: "staff", subject: "स्टाफ़ का व्यवहार", body: "डिलीवरी वाले ने सामान दुकान के बाहर ही छोड़ दिया।" }, new Date(now - 3 * DAY))
  );
  await as(adminId, (ctx) => officeReply(ctx, adminId, resolved.id, { body: "हमने ड्राइवर से बात की है। आगे से सामान अंदर रखा जाएगा।" }, new Date(now - 2 * DAY)));
  await as(sai, (ctx) => retailerReply(ctx, sai, ids.shops.sai, resolved.id, { body: "धन्यवाद।" }));
  await as(adminId, (ctx) => officeReply(ctx, adminId, resolved.id, { status: "RESOLVED", body: "Spoke to the driver; goods go inside the shop from now on." }, new Date(now - DAY)));

  // ── announcements
  const diwali = await as(adminId, (ctx) =>
    saveAnnouncement(ctx, adminId, null, {
      title: "Diwali offer: 5% off sweets",
      body: "Order sweets and dry-fruit boxes before 30 Nov for 5% off. Limited stock.",
      audience: "RETAILERS",
      link: "/retailer/catalogue",
      pinned: true,
      endsAt: new Date(now + 14 * DAY).toISOString(),
      channels: ["push", "whatsapp"],
    })
  );
  await as(adminId, (ctx) => publishAnnouncement(ctx, diwali.id));
  await as(adminId, (ctx) =>
    saveAnnouncement(ctx, adminId, null, {
      title: "Sunday delivery in your area",
      body: "From next month we deliver on Sundays too, between 10 am and 2 pm.",
      audience: "RETAILERS",
      areaIds: ids.areas.slice(0, 1),
      channels: ["push"],
    })
  );
  const staff = await as(adminId, (ctx) =>
    saveAnnouncement(ctx, adminId, null, { title: "Team meeting Monday 9 am", body: "All field staff at the office. Bring your target sheet.", audience: "STAFF", channels: ["push"] })
  );
  await as(adminId, (ctx) => publishAnnouncement(ctx, staff.id));

  // ── a statement sent from the khata, then send what is queued (no provider → "logged")
  await as(adminId, (ctx) => sendStatement(ctx.tx, ctx.tenantId, ids.shops.patel, `statement:${ids.shops.patel}:seed`));
  await flushTenant(T, 500);
}
