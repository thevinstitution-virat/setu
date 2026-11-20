import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";

/** GET → { count } of my unread notifications (the bell polls this; signed out = 0). */
export async function GET() {
  const auth = await guard();
  if (!auth.ok) return NextResponse.json({ count: 0 });
  const count = await auth.db.notification.count({ where: { userId: auth.session.userId, readAt: null } });
  return NextResponse.json({ count }, { headers: { "Cache-Control": "no-store" } });
}
