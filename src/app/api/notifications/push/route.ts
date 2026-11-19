import { engageWrite } from "@/lib/engage-api";
import { MoneyError } from "@/lib/money-error";

/** Body: the browser's PushSubscription JSON { endpoint, keys: { p256dh, auth } } → saved for me. */
export async function POST(req: Request) {
  const ua = req.headers.get("user-agent")?.slice(0, 200) ?? null;
  return engageWrite(
    req,
    "push.subscribe",
    null,
    async (ctx, b, s) => {
      const endpoint = typeof b.endpoint === "string" ? b.endpoint : "";
      const keys = (b.keys ?? {}) as { p256dh?: unknown; auth?: unknown };
      if (!/^https:\/\/[^\s]{10,800}$/.test(endpoint) || typeof keys.p256dh !== "string" || typeof keys.auth !== "string" || keys.p256dh.length > 200 || keys.auth.length > 100) {
        throw new MoneyError("This browser's push details look wrong");
      }
      // One endpoint belongs to whoever subscribed last on that browser (shared phones change hands).
      const existing = await ctx.tx.pushSubscription.findUnique({ where: { tenantId_endpoint: { tenantId: ctx.tenantId, endpoint } } });
      if (existing) {
        return ctx.tx.pushSubscription.update({ where: { id: existing.id }, data: { userId: s.userId, p256dh: keys.p256dh, auth: keys.auth, userAgent: ua }, select: { id: true } });
      }
      const count = await ctx.tx.pushSubscription.count({ where: { userId: s.userId } });
      if (count >= 10) throw new MoneyError("Too many phones and browsers. Turn notifications off on one you no longer use.", 409);
      return ctx.tx.pushSubscription.create({ data: { userId: s.userId, endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent: ua }, select: { id: true } });
    },
    { entity: "PushSubscription", status: 201 }
  );
}

/** Body: { endpoint } → this browser stops getting my notifications. */
export async function DELETE(req: Request) {
  return engageWrite(
    req,
    "push.unsubscribe",
    null,
    async (ctx, b, s) => {
      const r = await ctx.tx.pushSubscription.deleteMany({ where: { userId: s.userId, endpoint: typeof b.endpoint === "string" ? b.endpoint : "" } });
      return { count: r.count };
    },
    { entity: "PushSubscription" }
  );
}
