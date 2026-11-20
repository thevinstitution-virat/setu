/**
 * Phase 10 demo: about four months of trading history so the reports have
 * something to show. Every sale goes through the real ledger engine (invoice,
 * bill, ledger entries, payments, allocations, credit notes) with the date it
 * happened, so balances, ageing and GST documents agree with each other.
 *
 * - Each shop orders on its own rhythm (every 3 to 10 days); one shop stopped
 *   ordering about 45 days ago (at risk) and one about 10 days ago (slipping).
 * - Orders are delivered the next day on trips (some late, some on a second
 *   attempt, a few not delivered at all), some lines short.
 * - About half are paid at the door (cash or UPI); most of the rest a week or
 *   two later; some are still open (so ageing has every bucket).
 * - A few goods returns (credit notes) and scheme redemptions.
 * - Visits with order / no-order outcomes for the days before the field demo.
 * Stock is not touched (the stock demo stays as it is); margins use each
 * product's last purchase cost. Names and numbers are made up.
 */
import type { Db } from "./seed";
import type { PrismaClient } from "../src/generated/prisma/client";
import { bookSale, cashInHand, issueCreditNote, onOrderDelivered, recordHandover, recordPayment, withMoney } from "../src/lib/ledger";
import { fyLabel, nextOrderNumber, nextSequence, priceBreakup } from "../src/lib/orders";
import { docNumber } from "../src/lib/gst";
import { addDay, istDay, istDayRange } from "../src/lib/field-math";
import { generateEInvoice } from "../src/lib/einvoice";

let seed = 1010;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const at = (day: string, minutesIst: number) => new Date(istDayRange(day).from.getTime() + minutesIst * 60_000);

const HISTORY_DAYS = 120;
/** The field demo owns visits for the last 14 days. */
const FIELD_DAYS = 14;
const FAIL = ["shop_closed", "owner_away", "no_payment", "refused"] as const;
const SHORT = ["damaged", "short_loaded", "expired", "refused"] as const;
const NO_ORDER = ["stock_enough", "owner_away", "dues_pending", "price", "next_visit"] as const;
const RETURN_REASONS = ["Damaged in transit", "Near expiry", "Wrong item sent", "Leaking pack"];

export async function seedAnalytics(db: Db, prisma: PrismaClient, tenantId: string) {
  const today = istDay();
  const [shops, agents, drivers, products, schemes] = await Promise.all([
    db.retailerProfile.findMany({ where: { OR: [{ paymentMode: null }, { paymentMode: { not: "PREPAID" } }] }, select: { id: true, userId: true, salesAgentId: true }, orderBy: { createdAt: "asc" } }),
    db.salesAgentProfile.findMany({ select: { id: true, userId: true }, orderBy: { id: "asc" } }),
    db.deliveryAgentProfile.findMany({ select: { id: true, userId: true }, orderBy: { id: "asc" } }),
    db.product.findMany({ where: { active: true }, select: { id: true, price: true, gstRate: true }, orderBy: { sku: "asc" } }),
    db.scheme.findMany({ where: { active: true }, select: { id: true } }),
  ]);
  if (!shops.length || !agents.length || !drivers.length || !products.length) return;
  const adminId = (await db.user.findFirstOrThrow({ where: { role: "ADMIN" }, select: { id: true } })).id;

  type Plan = { shop: (typeof shops)[number]; gap: number; stopAfter: string | null; next: string };
  const plans: Plan[] = shops.map((shop, i) => ({
    shop,
    gap: [4, 6, 5, 7, 3, 4, 9, 6, 10, 5][i % 10],
    stopAfter: i === 2 ? addDay(today, -45) : i === 5 ? addDay(today, -10) : null,
    next: addDay(today, -HISTORY_DAYS + (i % 5)),
  }));

  // Cash the demo staff already hold (the cash-handover demo); history cash is handed over at the end.
  const staffIds = [...new Set([...agents.map((a) => a.userId), ...drivers.map((d) => d.userId)])];
  const heldBefore = new Map<string, number>();
  for (const id of staffIds) heldBefore.set(id, await withMoney(tenantId, adminId, (ctx) => cashInHand(ctx, id)));

  const trips = new Map<string, string>();
  const unpaid: { retailerId: string; amount: number; day: string }[] = [];
  let orders = 0;

  for (let day = addDay(today, -HISTORY_DAYS); day < today; day = addDay(day, 1)) {
    for (const [i, plan] of plans.entries()) {
      if (plan.next > day) continue;
      plan.next = addDay(day, Math.max(2, plan.gap + int(-1, 2)));
      if (plan.stopAfter && day > plan.stopAfter) continue;
      orders++;

      // What was ordered (some lines short at the door).
      const lines = [...products].sort(() => rnd() - 0.5).slice(0, int(2, 4)).map((p) => {
        const ordered = int(2, 12);
        const short = rnd() < 0.08 ? int(1, Math.min(2, ordered - 1)) : 0;
        return { productId: p.id, price: p.price, gstRate: p.gstRate, quantity: ordered - short, orderedQty: short ? ordered : null, deliveredQty: short ? ordered - short : null, shortReason: short ? pick(SHORT) : null };
      });
      const b = priceBreakup(lines);
      const agent = agents.find((a) => a.id === plan.shop.salesAgentId) ?? agents[0];
      const byAgent = rnd() < 0.7;
      const placedAt = at(day, int(600, 1020));
      const failed = rnd() < 0.05;
      const late = !failed && rnd() < 0.12;
      const deliverDay = addDay(day, late ? 2 : 1);
      const driver = pick(drivers);
      const deliveredAt = at(deliverDay > today ? today : deliverDay, int(660, 1140));
      const tripKey = `${deliverDay}:${driver.id}`;
      let tripId = trips.get(tripKey) ?? null;
      if (!tripId && deliverDay <= today) {
        const fy = fyLabel(at(deliverDay, 600));
        const trip = await db.trip.create({
          data: {
            number: docNumber("TRP", fy, await nextSequence(db, tenantId, `trip:${fy}`)),
            date: new Date(`${deliverDay}T00:00:00Z`),
            slot: "morning",
            driverId: driver.id,
            status: deliverDay < today ? "CLOSED" : "STARTED",
            startedAt: at(deliverDay, 600),
            closedAt: deliverDay < today ? at(deliverDay, 1170) : null,
            createdById: adminId,
            createdAt: at(addDay(deliverDay, -1), 1200),
          },
        });
        tripId = trip.id;
        trips.set(tripKey, tripId);
      }
      // Two shops never get schemes, so scheme ROI has shops to compare with.
      const scheme = schemes.length && i % 4 !== 3 && rnd() < 0.18 ? pick(schemes) : null;
      const schemeValue = scheme ? Math.round(b.subtotal * 0.03) : 0;
      const order = await db.order.create({
        data: {
          orderNumber: await nextOrderNumber(db, tenantId, placedAt),
          retailerId: plan.shop.id,
          placedById: byAgent ? agent.userId : plan.shop.userId,
          status: failed ? "CANCELLED" : "DELIVERED",
          ...b,
          grossAmount: b.subtotal + schemeValue,
          discountAmount: schemeValue,
          deliveryDate: new Date(`${addDay(day, 1)}T00:00:00Z`),
          orderedTotal: lines.some((l) => l.orderedQty) ? priceBreakup(lines.map((l) => ({ ...l, quantity: l.orderedQty ?? l.quantity }))).totalAmount : null,
          createdAt: placedAt,
          items: { create: lines },
          statusEvents: { create: [{ status: "PLACED", actorId: byAgent ? agent.userId : plan.shop.userId, createdAt: placedAt }, { status: failed ? "CANCELLED" : "DELIVERED", actorId: driver.userId, createdAt: deliveredAt }] },
          delivery: {
            create: {
              deliveryAgentId: driver.id,
              tripId,
              assignedAt: at(day, 1200),
              seq: int(1, 12),
              paymentMethod: "CASH",
              paymentStatus: "PENDING",
              codAmount: b.totalAmount,
              attempts: failed ? 2 : rnd() < 0.1 ? 2 : 1,
              ...(failed ? { state: "FAILED" as const, failReason: pick(FAIL), failedAt: deliveredAt } : { state: "DELIVERED" as const, deliveredAt }),
            },
          },
        },
      });
      if (scheme) {
        await db.schemeRedemption.create({ data: { schemeId: scheme.id, orderId: order.id, retailerId: plan.shop.id, value: schemeValue, createdAt: placedAt } });
        await db.scheme.update({ where: { id: scheme.id }, data: { spent: { increment: schemeValue } } });
      }
      if (byAgent && day < addDay(today, -FIELD_DAYS)) {
        await db.visit.create({ data: { salesAgentId: agent.id, retailerId: plan.shop.id, checkInAt: placedAt, checkOutAt: new Date(placedAt.getTime() + 12 * 60_000), outcome: "ORDER", orderId: order.id } });
      }
      if (failed) continue;

      // Invoice + bill on the delivery day; about half paid at the door.
      const paidAtDoor = rnd() < 0.5;
      const invoice = await withMoney(tenantId, driver.userId, async (ctx) => {
        const { invoice } = await bookSale(ctx, order.id, deliveredAt);
        await onOrderDelivered(ctx, order, paidAtDoor ? { amount: order.totalAmount, method: rnd() < 0.7 ? "CASH" : "UPI", collectorId: driver.userId, reference: null, occurredAt: deliveredAt } : null);
        return invoice;
      });
      if (!paidAtDoor) unpaid.push({ retailerId: plan.shop.id, amount: order.totalAmount, day: deliverDay });

      // A few goods returns two days later.
      const returnDay = addDay(deliverDay, 2);
      if (invoice && rnd() < 0.05 && returnDay < today) {
        await withMoney(tenantId, adminId, async (ctx) => {
          const inv = await ctx.tx.invoice.findUniqueOrThrow({ where: { id: invoice.id }, include: { lines: { orderBy: { sl: "asc" } } } });
          await issueCreditNote(ctx, { invoiceId: inv.id, kind: "return", reason: pick(RETURN_REASONS), lines: [{ lineId: inv.lines[0].id, quantity: 1 }] }, at(returnDay, 720));
        });
      }
    }

    // No-order visits on the days before the field demo.
    if (day < addDay(today, -FIELD_DAYS) && new Date(`${day}T00:00:00Z`).getUTCDay() !== 0) {
      for (let k = int(1, 3); k > 0; k--) {
        const shop = pick(shops);
        const agent = agents.find((a) => a.id === shop.salesAgentId) ?? agents[0];
        const inAt = at(day, int(600, 1080));
        await db.visit.create({ data: { salesAgentId: agent.id, retailerId: shop.id, checkInAt: inAt, checkOutAt: new Date(inAt.getTime() + 8 * 60_000), outcome: "NO_ORDER", noOrderReason: pick(NO_ORDER) } });
      }
    }
  }

  // Later payments: most open bills are paid one to three weeks after delivery.
  for (const u of unpaid) {
    if (rnd() < 0.25) continue;
    const payDay = addDay(u.day, int(5, 21));
    if (payDay >= today) continue;
    const agent = agents.find((a) => a.id === shops.find((s) => s.id === u.retailerId)?.salesAgentId) ?? agents[0];
    await withMoney(tenantId, agent.userId, (ctx) =>
      recordPayment(ctx, { retailerId: u.retailerId, amount: u.amount, method: pick(["CASH", "UPI", "BANK"] as const), reference: null, collectorId: agent.userId, occurredAt: at(payDay, int(660, 1080)) })
    );
  }

  for (const id of staffIds) {
    const extra = (await withMoney(tenantId, adminId, (ctx) => cashInHand(ctx, id))) - (heldBefore.get(id) ?? 0);
    if (extra <= 0) continue;
    await withMoney(tenantId, adminId, async (ctx) => {
      const h = await recordHandover(ctx, { staffUserId: id, counted: extra, note: "Cash from past trips" });
      // The demo cash they still hold is not a shortage.
      await ctx.tx.cashHandover.update({ where: { id: h.id }, data: { expected: extra, variance: 0 } });
    });
  }

  // e-Invoices (sandbox) for the B2B documents, as the worker would.
  for (const d of await db.invoice.findMany({ where: { einvStatus: "PENDING" }, orderBy: { createdAt: "asc" }, select: { id: true } })) {
    await generateEInvoice(tenantId, d.id).catch(() => undefined);
  }
  void prisma;
  console.log(`  analytics history: ${orders} orders over ${HISTORY_DAYS} days, ${trips.size} trips`);
}
