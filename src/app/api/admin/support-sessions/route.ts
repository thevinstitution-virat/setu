import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { endSupport } from "@/lib/support";

/** Times platform support worked inside this business (and any still open). */
export async function GET() {
  const auth = await guard("settings.manage");
  if (!auth.ok) return auth.res;
  const now = new Date();
  const rows = await auth.db.supportSession.findMany({ orderBy: { startedAt: "desc" }, take: 50, include: { platformUser: { select: { name: true } } } });
  return NextResponse.json({
    sessions: rows.map((s) => ({
      id: s.id,
      by: s.platformUser.name,
      reason: s.reason,
      mode: s.mode,
      startedAt: s.startedAt,
      expiresAt: s.expiresAt,
      endedAt: s.endedAt,
      used: !!s.usedAt,
      live: !s.endedAt && s.expiresAt > now,
    })),
  });
}

/** Body: { id } — the owner ends a support session at once. */
export async function POST(req: Request) {
  const auth = await guard("settings.manage");
  if (!auth.ok) return auth.res;
  if (auth.session.supportId) return NextResponse.json({ error: "Use End session in the banner" }, { status: 400 });
  const body = await req.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  const s = await auth.db.supportSession.findUnique({ where: { id } });
  if (!s) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  await endSupport(auth.tenant.id, id, `owner (${auth.session.name})`);
  return NextResponse.json({ ok: true });
}
