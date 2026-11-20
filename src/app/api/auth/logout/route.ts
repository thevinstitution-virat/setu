import { NextResponse } from "next/server";
import { clearSessionCookie, getSession } from "@/lib/auth";
import { tenantDb } from "@/lib/db";

/** Signs out here. Body { everywhere: true } also ends this person's sessions on every other device. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { everywhere?: unknown } | null;
  if (body?.everywhere === true) {
    const s = await getSession();
    if (s) await tenantDb(s.tenantId).user.update({ where: { id: s.userId }, data: { sessionVersion: { increment: 1 } } });
  }
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
