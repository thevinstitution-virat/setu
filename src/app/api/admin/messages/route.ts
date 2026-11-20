import type { MessageChannel, MessageStatus, Prisma } from "@/generated/prisma/client";
import { engageRead, engageWrite, before, qp } from "@/lib/engage-api";
import { channelStatus } from "@/lib/outbox";
import { notify } from "@/lib/notify";

const STATUSES: MessageStatus[] = ["QUEUED", "SENT", "FAILED", "LOGGED", "SKIPPED"];
const CHANNELS: MessageChannel[] = ["SMS", "WHATSAPP", "PUSH"];

/** GET ?status=&channel=&event=&q=&before= → the message log, newest first, with counts for the last 7 days. */
export async function GET(req: Request) {
  const sp = qp(req);
  const b = before(sp);
  return engageRead("messages.manage", async (ctx) => {
    const where: Prisma.MessageLogWhereInput = {};
    const st = sp.get("status");
    if (st && (STATUSES as string[]).includes(st)) where.status = st as MessageStatus;
    const ch = sp.get("channel");
    if (ch && (CHANNELS as string[]).includes(ch)) where.channel = ch as MessageChannel;
    if (sp.get("event")) where.event = sp.get("event")!;
    const q = (sp.get("q") ?? "").trim().slice(0, 60);
    if (q) where.OR = [{ to: { contains: q } }, { body: { contains: q, mode: "insensitive" } }];
    if (b) where.createdAt = { lt: b };
    const since = new Date(Date.now() - 7 * 24 * 3600_000);
    const [items, counts] = await Promise.all([
      ctx.tx.messageLog.findMany({ where, orderBy: { createdAt: "desc" }, take: 50 }),
      ctx.tx.messageLog.groupBy({ by: ["status", "channel"], where: { createdAt: { gte: since } }, _count: true }),
    ]);
    const names = await ctx.tx.user.findMany({ where: { id: { in: [...new Set(items.map((m) => m.userId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } });
    return {
      channels: channelStatus(),
      counts: counts.map((c) => ({ status: c.status, channel: c.channel, count: c._count })),
      items: items.map((m) => ({ ...m, name: names.find((n) => n.id === m.userId)?.name ?? null })),
      more: items.length === 50,
    };
  });
}

/** POST → a test notification to me (in-app, and push if this browser is subscribed). */
export async function POST(req: Request) {
  return engageWrite(
    req,
    "message.test",
    "messages.manage",
    async (ctx, _b, s) =>
      notify(ctx.tx, ctx.tenantId, {
        event: "staff.announcement",
        to: [s.userId],
        vars: { title: "Test message", body: "Notifications work on this phone or browser." },
        key: `test:${s.userId}:${Date.now()}`,
        link: "/notifications",
        channels: ["push"],
      }),
    { entity: "MessageLog" }
  );
}
