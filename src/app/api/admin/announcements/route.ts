import { engageRead, engageWrite } from "@/lib/engage-api";
import { saveAnnouncement } from "@/lib/announcements";

/** GET → all announcements, newest first, with the areas and groups to pick from. */
export async function GET() {
  return engageRead("promotions.manage", async (ctx) => {
    const [items, areas, groups] = await Promise.all([
      ctx.tx.announcement.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { createdBy: { select: { name: true } } } }),
      ctx.tx.area.findMany({ select: { id: true, name: true, region: { select: { name: true } } }, orderBy: { name: "asc" } }),
      ctx.tx.retailerGroup.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]);
    return { items, areas, groups };
  });
}

/** Body: { title, body, audience, areaIds?, groupIds?, roles?, link?, imageKey?, pinned?, startsAt?, endsAt?, channels? } → a draft. */
export async function POST(req: Request) {
  return engageWrite(req, "announcement.create", "promotions.manage", (ctx, b, s) => saveAnnouncement(ctx, s.userId, null, b), { entity: "Announcement", status: 201 });
}
