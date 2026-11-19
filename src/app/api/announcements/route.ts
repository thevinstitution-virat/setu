import { engageRead } from "@/lib/engage-api";
import { liveFor } from "@/lib/announcements";

/** GET → announcements live for me now (home page cards), pinned first. */
export async function GET() {
  return engageRead(null, async (ctx, s) => ({
    items: (await liveFor(ctx.tx, { id: s.userId, role: s.role })).map((a) => ({
      id: a.id,
      title: a.title,
      body: a.body,
      link: a.link,
      imageKey: a.imageKey,
      pinned: a.pinned,
      startsAt: a.startsAt,
      endsAt: a.endsAt,
    })),
  }));
}
