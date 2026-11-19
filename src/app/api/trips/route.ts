import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { withMoney } from "@/lib/ledger";
import { moneyFail } from "@/lib/money-api";
import { addOrders, createTrip } from "@/lib/trips";
import { deliverySettings } from "@/lib/delivery-settings";
import { istDate } from "@/lib/gst";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Dispatch board for one day (?date=YYYY-MM-DD, default today IST):
 * the day's trips, orders ready to go (not on an open trip, due that day or
 * earlier), drivers, vehicles and slots.
 */
export async function GET(req: Request) {
  const auth = await guard("orders.dispatch");
  if (!auth.ok) return auth.res;
  const { db, tenant } = auth;
  const q = new URL(req.url).searchParams.get("date");
  const ymd = q && YMD.test(q) ? q : istDate(new Date());
  const day = new Date(`${ymd}T00:00:00.000Z`);

  const [trips, ready, drivers, vehicles] = await Promise.all([
    db.trip.findMany({
      where: { date: day },
      orderBy: [{ createdAt: "asc" }],
      include: {
        driver: { select: { id: true, user: { select: { name: true, phone: true } } } },
        vehicle: { select: { id: true, number: true, name: true } },
        deliveries: { select: { state: true, order: { select: { totalAmount: true, invoices: { select: { type: true, total: true } } } } } },
      },
    }),
    db.order.findMany({
      where: {
        status: { in: ["PLACED", "CONFIRMED", "PACKED"] },
        NOT: { AND: [{ creditHold: true }, { creditApprovedAt: null }] },
        AND: [
          { OR: [{ deliveryDate: null }, { deliveryDate: { lte: day } }] },
          { OR: [{ delivery: null }, { delivery: { tripId: null } }, { delivery: { trip: { status: "CLOSED" } } }] },
        ],
      },
      orderBy: [{ deliveryDate: "asc" }, { createdAt: "asc" }],
      take: 500,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        totalAmount: true,
        deliveryDate: true,
        createdAt: true,
        _count: { select: { items: true } },
        delivery: { select: { failReason: true, attempts: true } },
        retailer: { select: { id: true, outletName: true, pinCode: true, lat: true, area: { select: { id: true, name: true } } } },
      },
    }),
    db.deliveryAgentProfile.findMany({ where: { user: { active: true } }, select: { id: true, user: { select: { name: true, phone: true } } }, orderBy: { user: { name: "asc" } } }),
    db.vehicle.findMany({ where: { active: true }, orderBy: { number: "asc" }, select: { id: true, number: true, name: true, capacityKg: true } }),
  ]);

  return NextResponse.json({
    date: ymd,
    today: istDate(new Date()),
    slots: deliverySettings(tenant.settings).slots,
    trips: trips.map((t) => ({
      id: t.id,
      number: t.number,
      slot: t.slot,
      status: t.status,
      note: t.note,
      driver: { id: t.driver.id, name: t.driver.user.name, phone: t.driver.user.phone },
      vehicle: t.vehicle,
      stops: t.deliveries.length,
      delivered: t.deliveries.filter((d) => d.state === "DELIVERED").length,
      failed: t.deliveries.filter((d) => d.state === "FAILED").length,
      // Net of short-delivery credit notes, as on the trip page.
      value: t.deliveries.reduce((a, d) => {
        const sale = d.order.invoices.find((i) => i.type === "TAX_INVOICE" || i.type === "BILL_OF_SUPPLY");
        const credited = d.order.invoices.filter((i) => i.type === "CREDIT_NOTE").reduce((x, i) => x + i.total, 0);
        return a + (sale ? sale.total - credited : d.order.totalAmount);
      }, 0),
      startedAt: t.startedAt,
      closedAt: t.closedAt,
    })),
    ready: ready.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      total: o.totalAmount,
      deliveryDate: o.deliveryDate ? o.deliveryDate.toISOString().slice(0, 10) : null,
      createdAt: o.createdAt,
      lines: o._count.items,
      retry: o.delivery?.failReason ? { reason: o.delivery.failReason, attempts: o.delivery.attempts } : null,
      retailer: { id: o.retailer.id, outletName: o.retailer.outletName, pinCode: o.retailer.pinCode, area: o.retailer.area, located: o.retailer.lat !== null },
    })),
    drivers: drivers.map((d) => ({ id: d.id, name: d.user.name, phone: d.user.phone })),
    vehicles,
  });
}

/** New trip. Body: { date: YYYY-MM-DD, slot, driverId, vehicleId?, note?, orderIds? } */
export async function POST(req: Request) {
  const auth = await guard("orders.dispatch");
  if (!auth.ok) return auth.res;
  const { session, db, tenant } = auth;
  const body = await req.json().catch(() => null);
  let trip;
  try {
    trip = await withMoney(tenant.id, session.userId, async (ctx) => {
      const t = await createTrip(ctx, {
        date: typeof body?.date === "string" ? body.date : istDate(new Date()),
        slot: String(body?.slot ?? ""),
        driverId: String(body?.driverId ?? ""),
        vehicleId: typeof body?.vehicleId === "string" && body.vehicleId ? body.vehicleId : null,
        note: typeof body?.note === "string" ? body.note : null,
      });
      if (Array.isArray(body?.orderIds) && body.orderIds.length) {
        await addOrders(ctx, t.id, body.orderIds.map(String));
      }
      return t;
    });
  } catch (e) {
    return moneyFail(e);
  }
  await audit(db, { actorId: session.userId, action: "trip.create", entity: "Trip", entityId: trip.id, after: { number: trip.number, date: body?.date, slot: trip.slot, driverId: trip.driverId, vehicleId: trip.vehicleId, orders: body?.orderIds?.length ?? 0 }, ip: requestIp(req) });
  return NextResponse.json({ trip }, { status: 201 });
}
