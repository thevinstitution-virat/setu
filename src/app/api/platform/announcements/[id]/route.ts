import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requestIp } from "@/lib/audit";
import { platformAudit, platformGuard } from "@/lib/platform-auth";

/** End an announcement now (kept for the record). */
export async function DELETE(req: Request, ctx: RouteContext<"/api/platform/announcements/[id]">) {
  const g = await platformGuard();
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  const a = await prisma.platformAnnouncement.findUnique({ where: { id } });
  if (!a) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const now = new Date();
  await prisma.platformAnnouncement.update({ where: { id }, data: { endsAt: now, ...(a.startsAt > now ? { startsAt: new Date(now.getTime() - 1000) } : {}) } });
  await platformAudit(g.session.platformUserId, "announcement.end", { detail: { id }, ip: requestIp(req) });
  return NextResponse.json({ ok: true });
}
