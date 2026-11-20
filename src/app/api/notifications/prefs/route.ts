import { engageRead, engageWrite } from "@/lib/engage-api";
import { notifySettings } from "@/lib/engage-settings";
import { pushConfigured } from "@/lib/outbox";
import { MoneyError } from "@/lib/money-error";

const MUTES = ["sms", "whatsapp", "push", "reminders", "promo"];

/** GET → my language, what I turned off, which channels the business uses, push key and my subscriptions. */
export async function GET() {
  return engageRead(null, async (ctx, s) => {
    const [u, t, subs] = await Promise.all([
      ctx.tx.user.findUniqueOrThrow({ where: { id: s.userId }, select: { lang: true, mutes: true, phone: true, role: true } }),
      ctx.tx.tenant.findUnique({ where: { id: ctx.tenantId }, select: { settings: true } }),
      ctx.tx.pushSubscription.findMany({ where: { userId: s.userId }, select: { endpoint: true, userAgent: true, createdAt: true } }),
    ]);
    return {
      lang: u.lang,
      mutes: u.mutes,
      hasPhone: !!u.phone,
      retailer: u.role === "RETAILER",
      channels: notifySettings(t?.settings).channels,
      push: { ready: pushConfigured(), publicKey: process.env.VAPID_PUBLIC_KEY ?? null, devices: subs },
    };
  });
}

/** Body: { lang?: "en" | "hi", mutes?: string[] } */
export async function PATCH(req: Request) {
  return engageWrite(
    req,
    "notification.prefs",
    null,
    async (ctx, b, s) => {
      const data: { lang?: string; mutes?: string[] } = {};
      if ("lang" in b) {
        if (b.lang !== "en" && b.lang !== "hi") throw new MoneyError("Pick English or Hindi");
        data.lang = b.lang;
      }
      if ("mutes" in b) {
        if (!Array.isArray(b.mutes)) throw new MoneyError("Pick what to turn off");
        data.mutes = [...new Set(b.mutes.filter((m): m is string => typeof m === "string" && MUTES.includes(m)))];
      }
      return ctx.tx.user.update({ where: { id: s.userId }, data, select: { id: true, lang: true, mutes: true } });
    },
    { entity: "User" }
  );
}
