import { engageWrite } from "@/lib/engage-api";
import { sendStatement } from "@/lib/notify-flows";
import { MoneyError } from "@/lib/money-error";
import { DAY, limited } from "@/lib/rate-limit";

/** POST → send this retailer their balance and khata link now (in-app, and WhatsApp / SMS per settings). */
export async function POST(req: Request, { params }: { params: Promise<{ retailerId: string }> }) {
  const { retailerId } = await params;
  return engageWrite(
    req,
    "statement.send",
    "ledger.view",
    async (ctx) => {
      // Each send can go out on WhatsApp / SMS (paid, and a nuisance to the shop when repeated).
      if (await limited(`statement-send:${ctx.tenantId}`, retailerId, 3, DAY)) throw new MoneyError("This shop was sent its statement 3 times today. Try again tomorrow.", 429);
      const ok = await sendStatement(ctx.tx, ctx.tenantId, retailerId, `statement:${retailerId}:${Date.now()}`);
      if (!ok) throw new MoneyError("Shop not found or its login is turned off", 404);
      return { id: retailerId };
    },
    { entity: "RetailerProfile", entityId: retailerId }
  );
}
