import { stockMutation, str } from "@/lib/stock-api";
import { fieldRead, optNum, qp } from "@/lib/field-api";
import { startVisit } from "@/lib/field";
import { MoneyError } from "@/lib/money-error";
import { isDay, istDay, istDayRange } from "@/lib/field-math";

/** GET ?date= → my visits that day (sales agents), plus the open one. */
export async function GET(req: Request) {
  const date = qp(req).get("date") || istDay();
  return fieldRead("field.work", async (ctx, who) => {
    if (!isDay(date)) throw new MoneyError("Pick a day");
    const { from, to } = istDayRange(date);
    const visits = await ctx.tx.visit.findMany({
      where: { salesAgent: { userId: who.userId }, checkInAt: { gte: from, lt: to } },
      include: { retailer: { select: { outletName: true } }, order: { select: { orderNumber: true, totalAmount: true } } },
      orderBy: { checkInAt: "asc" },
    });
    const open = await ctx.tx.visit.findFirst({ where: { salesAgent: { userId: who.userId }, checkOutAt: null }, include: { retailer: { select: { outletName: true } } } });
    return { visits, open };
  });
}

/** Body: { retailerId, lat?, lng?, accuracy? } → check in at a shop. */
export async function POST(req: Request) {
  return stockMutation(
    req,
    "visit.start",
    (ctx, b) => {
      const retailerId = str(b.retailerId, 60);
      if (!retailerId) throw new MoneyError("Pick the shop");
      return startVisit(ctx, { userId: ctx.actorId!, role: "SALES_AGENT" }, retailerId, { lat: optNum(b.lat), lng: optNum(b.lng), accuracy: optNum(b.accuracy) });
    },
    { perm: "field.work", entity: "Visit", status: 201 }
  );
}
