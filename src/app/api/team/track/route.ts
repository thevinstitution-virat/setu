import { fieldRead, qp } from "@/lib/field-api";
import { fieldSettingsOf, inScope, teamScope } from "@/lib/field";
import { MoneyError } from "@/lib/money-error";
import { isDay, istDay, istDayRange, pathMetres } from "@/lib/field-math";

/** GET ?userId=&date= → one person's positions and visits that day (route replay). */
export async function GET(req: Request) {
  const sp = qp(req);
  return fieldRead("team.supervise", async (ctx, who) => {
    const userId = sp.get("userId") ?? "";
    const date = sp.get("date") || istDay();
    if (!isDay(date)) throw new MoneyError("Pick a day");
    if (!inScope(await teamScope(ctx.tx, who), userId)) throw new MoneyError("Not in your team", 403);
    const { from, to } = istDayRange(date);
    const [user, attendance, pings, visits, orders, pays, settings] = await Promise.all([
      ctx.tx.user.findUnique({ where: { id: userId }, select: { name: true, role: true } }),
      ctx.tx.attendance.findUnique({ where: { tenantId_userId_date: { tenantId: ctx.tenantId, userId, date } } }),
      ctx.tx.locationPing.findMany({ where: { userId, at: { gte: from, lt: to } }, orderBy: { at: "asc" }, select: { at: true, lat: true, lng: true, accuracy: true, battery: true } }),
      ctx.tx.visit.findMany({
        where: { salesAgent: { userId }, checkInAt: { gte: from, lt: to } },
        orderBy: { checkInAt: "asc" },
        select: { id: true, notes: true, checkInAt: true, checkOutAt: true, checkInLat: true, checkInLng: true, outcome: true, noOrderReason: true, distanceM: true, offBeat: true, retailer: { select: { outletName: true, lat: true, lng: true } }, order: { select: { orderNumber: true, totalAmount: true } } },
      }),
      ctx.tx.order.aggregate({ where: { placedById: userId, createdAt: { gte: from, lt: to }, status: { not: "CANCELLED" } }, _sum: { totalAmount: true }, _count: true }),
      ctx.tx.payment.aggregate({ where: { collectedById: userId, collectedAt: { gte: from, lt: to }, state: { in: ["CONFIRMED", "PENDING_VERIFICATION", "POST_DATED"] } }, _sum: { amount: true } }),
      fieldSettingsOf(ctx.tx, ctx.tenantId),
    ]);
    if (!user) throw new MoneyError("Person not found", 404);
    return {
      user,
      date,
      // Still on duty today: hours so far, like Team today.
      attendance:
        attendance?.checkInAt && !attendance.checkOutAt && date === istDay()
          ? { ...attendance, minutes: Math.round((Date.now() - attendance.checkInAt.getTime()) / 60_000) }
          : attendance,
      pings,
      visits,
      distanceM: attendance?.distanceM ?? pathMetres(pings),
      orders: orders._count,
      orderValue: orders._sum.totalAmount ?? 0,
      collected: pays._sum.amount ?? 0,
      visitRadiusM: settings.visitRadiusM,
    };
  });
}
