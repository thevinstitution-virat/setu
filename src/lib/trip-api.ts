import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { can } from "@/lib/permissions";
import type { TenantDb } from "@/lib/db";

/**
 * Who may touch a trip: dispatch staff (orders.dispatch) any trip. With
 * `driver`, the trip's own driver too (read it, start it).
 */
export async function tripAuth(tripId: string, opts: { driver?: boolean } = {}) {
  const auth = await guard();
  if (!auth.ok) return auth;
  const trip = await auth.db.trip.findUnique({ where: { id: tripId }, include: { driver: { select: { userId: true } } } });
  if (!trip) return { ok: false as const, res: NextResponse.json({ error: "Trip not found" }, { status: 404 }) };
  const staff = can(auth.session.role, "orders.dispatch");
  const isDriver = can(auth.session.role, "delivery.work") && trip.driver.userId === auth.session.userId;
  if (!staff && !(opts.driver && isDriver)) {
    return { ok: false as const, res: NextResponse.json({ error: "You don't have access to this" }, { status: 403 }) };
  }
  return { ...auth, trip, staff, isDriver };
}

/** Stops of a trip as the screens need them (no delivery code). */
export async function tripStops(db: TenantDb, tripId: string) {
  const rows = await db.delivery.findMany({
    where: { tripId },
    orderBy: { seq: "asc" },
    include: {
      order: {
        select: {
          id: true,
          orderNumber: true,
          status: true,
          totalAmount: true,
          walletHold: true,
          notes: true,
          items: { select: { id: true } },
          invoices: { select: { type: true, total: true } },
          retailer: {
            select: {
              id: true,
              outletName: true,
              shopNumber: true,
              complexName: true,
              pinCode: true,
              lat: true,
              lng: true,
              deliveryPref: true,
              deliveryNote: true,
              area: { select: { name: true } },
              user: { select: { phone: true } },
            },
          },
        },
      },
    },
  });
  return rows.map((d) => {
    const sale = d.order.invoices.find((i) => i.type === "TAX_INVOICE" || i.type === "BILL_OF_SUPPLY");
    const credits = d.order.invoices.filter((i) => i.type === "CREDIT_NOTE").reduce((a, i) => a + i.total, 0);
    return {
      orderId: d.orderId,
      seq: d.seq,
      state: d.state,
      failReason: d.failReason,
      failNote: d.failNote,
      attempts: d.attempts,
      deliveredAt: d.deliveredAt,
      codeNeeded: !!d.code && !d.codeVerified,
      codAmount: d.codAmount,
      order: {
        id: d.order.id,
        orderNumber: d.order.orderNumber,
        status: d.order.status,
        total: sale ? sale.total - credits : d.order.totalAmount,
        walletHold: d.order.walletHold,
        notes: d.order.notes,
        lines: d.order.items.length,
        invoiced: !!sale,
      },
      retailer: {
        id: d.order.retailer.id,
        outletName: d.order.retailer.outletName,
        address: [d.order.retailer.shopNumber, d.order.retailer.complexName, d.order.retailer.area.name, d.order.retailer.pinCode].filter(Boolean).join(", "),
        area: d.order.retailer.area.name,
        phone: d.order.retailer.user.phone,
        lat: d.order.retailer.lat,
        lng: d.order.retailer.lng,
        deliveryPref: d.order.retailer.deliveryPref,
        deliveryNote: d.order.retailer.deliveryNote,
      },
    };
  });
}

export type TripStop = Awaited<ReturnType<typeof tripStops>>[number];

/** Google Maps directions link through the open stops (opens in the phone's maps app). */
export function directionsUrl(stops: { lat: number | null; lng: number | null; address: string }[]) {
  const pts = stops.map((s) => (s.lat !== null && s.lng !== null ? `${s.lat},${s.lng}` : s.address)).slice(0, 10);
  if (!pts.length) return null;
  const dest = pts[pts.length - 1];
  const way = pts.slice(0, -1);
  const q = new URLSearchParams({ api: "1", destination: dest, travelmode: "driving" });
  if (way.length) q.set("waypoints", way.join("|"));
  return `https://www.google.com/maps/dir/?${q.toString()}`;
}

/** Vehicle registration number: capitals and digits only (MH12AB1234). */
export const normalisePlate = (v: unknown) => String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
