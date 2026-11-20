import { engageRead, engageWrite, before, qp } from "@/lib/engage-api";

/** GET ?before=ISO&limit= → my notifications, newest first, and how many are unread. */
export async function GET(req: Request) {
  const sp = qp(req);
  const limit = Math.min(50, Math.max(1, Number(sp.get("limit")) || 30));
  const b = before(sp);
  return engageRead(null, async (ctx, s) => {
    const [items, unread] = await Promise.all([
      ctx.tx.notification.findMany({
        where: { userId: s.userId, ...(b ? { createdAt: { lt: b } } : {}) },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: { id: true, event: true, title: true, body: true, link: true, readAt: true, createdAt: true },
      }),
      ctx.tx.notification.count({ where: { userId: s.userId, readAt: null } }),
    ]);
    return { items, unread, more: items.length === limit };
  });
}

/** Body: { ids: string[] } or { all: true } → marked read. */
export async function POST(req: Request) {
  return engageWrite(
    req,
    "notification.read",
    null,
    async (ctx, b, s) => {
      const ids = Array.isArray(b.ids) ? b.ids.filter((x): x is string => typeof x === "string").slice(0, 200) : [];
      if (b.all !== true && !ids.length) return { count: 0 };
      const r = await ctx.tx.notification.updateMany({
        where: { userId: s.userId, readAt: null, ...(b.all === true ? {} : { id: { in: ids } }) },
        data: { readAt: new Date() },
      });
      return { count: r.count };
    },
    { entity: "Notification" }
  );
}
