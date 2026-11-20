import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requestIp } from "@/lib/audit";
import { platformAudit, platformGuard } from "@/lib/platform-auth";

/** Messages to businesses' offices (shown as a banner in the office app). */
export async function GET() {
  const g = await platformGuard();
  if (!g.ok) return g.res;
  const rows = await prisma.platformAnnouncement.findMany({ orderBy: { startsAt: "desc" }, take: 100, include: { createdBy: { select: { name: true } } } });
  return NextResponse.json({ announcements: rows });
}

/** Body: { title, body, level?: info|warning, audience?: ADMINS|STAFF, tenantIds?: [], startsAt?, endsAt? } */
export async function POST(req: Request) {
  const g = await platformGuard();
  if (!g.ok) return g.res;
  const b = await req.json().catch(() => null);
  const title = String(b?.title ?? "").trim();
  const body = String(b?.body ?? "").trim();
  if (title.length < 3 || title.length > 100) return NextResponse.json({ error: "Title: 3–100 characters" }, { status: 400 });
  if (body.length < 3 || body.length > 1000) return NextResponse.json({ error: "Message: 3–1000 characters" }, { status: 400 });
  const startsAt = b?.startsAt ? new Date(b.startsAt) : new Date();
  const endsAt = b?.endsAt ? new Date(b.endsAt) : null;
  if (Number.isNaN(startsAt.getTime()) || (endsAt && (Number.isNaN(endsAt.getTime()) || endsAt <= startsAt))) return NextResponse.json({ error: "Check the dates" }, { status: 400 });
  const tenantIds = Array.isArray(b?.tenantIds) ? b.tenantIds.filter((x: unknown) => typeof x === "string").slice(0, 500) : [];
  const row = await prisma.platformAnnouncement.create({
    data: { title, body, level: b?.level === "warning" ? "warning" : "info", audience: b?.audience === "STAFF" ? "STAFF" : "ADMINS", tenantIds, startsAt, endsAt, createdById: g.session.platformUserId },
  });
  await platformAudit(g.session.platformUserId, "announcement.create", { detail: { id: row.id, title }, ip: requestIp(req) });
  return NextResponse.json(row, { status: 201 });
}
