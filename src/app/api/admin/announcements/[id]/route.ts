import { engageWrite } from "@/lib/engage-api";
import { audienceOf, publishAnnouncement, saveAnnouncement } from "@/lib/announcements";
import { MoneyError } from "@/lib/money-error";

/** Body: same as creating. Once sent, only the text, link, picture, pin and dates can change. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return engageWrite(req, "announcement.update", "promotions.manage", (ctx, b, s) => saveAnnouncement(ctx, s.userId, id, b), { entity: "Announcement", entityId: id });
}

/** Body: { action: "publish" } sends it now; { action: "count" } says how many people it would reach; { action: "end" } takes it down. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return engageWrite(
    req,
    "announcement.action",
    "promotions.manage",
    async (ctx, b) => {
      const a = await ctx.tx.announcement.findUnique({ where: { id } });
      if (!a) throw new MoneyError("Announcement not found", 404);
      if (b.action === "count") return { reach: (await audienceOf(ctx.tx, a)).length };
      if (b.action === "publish") return publishAnnouncement(ctx, id);
      if (b.action === "end" && !a.publishedAt) throw new MoneyError("A draft is not live. Delete it instead.", 409);
      if (b.action === "end") return ctx.tx.announcement.update({ where: { id }, data: { endsAt: new Date(Math.max(Date.now(), a.startsAt.getTime() + 1000)) } });
      throw new MoneyError("Say publish, count or end");
    },
    { entity: "Announcement", entityId: id }
  );
}

/** Delete a draft (a sent announcement can only be ended). */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return engageWrite(
    req,
    "announcement.delete",
    "promotions.manage",
    async (ctx) => {
      const r = await ctx.tx.announcement.deleteMany({ where: { id, publishedAt: null } });
      if (!r.count) throw new MoneyError("Only a draft can be deleted. End a sent one instead.", 409);
      return { id };
    },
    { entity: "Announcement", entityId: id }
  );
}
