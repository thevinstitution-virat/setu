import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { bad, parseScheme } from "@/lib/catalogue-api";

/** Change a scheme. The type is fixed; switch it off (active: false) instead of deleting — orders keep their redemptions. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard("pricing.manage");
  if (!auth.ok) return auth.res;
  const { db, session } = auth;
  const { id } = await params;
  const before = await db.scheme.findUnique({ where: { id } });
  if (!before) return bad("Not found", 404);
  const b = (await req.json().catch(() => null)) ?? {};
  const data = await parseScheme(db, b, before);
  if (typeof data === "string") return bad(data);
  const starts = "startsAt" in data ? (data.startsAt as Date | null) : before.startsAt;
  const ends = "endsAt" in data ? (data.endsAt as Date | null) : before.endsAt;
  if (starts && ends && starts > ends) return bad("The scheme ends before it starts");
  if (data.couponCode && (await db.scheme.findFirst({ where: { id: { not: id }, couponCode: data.couponCode as string } }))) return bad("That coupon code is already used", 409);
  const scheme = await db.scheme.update({ where: { id }, data: data as never });
  await audit(db, { actorId: session.userId, action: "scheme.update", entity: "Scheme", entityId: id, before, after: scheme, ip: requestIp(req) });
  return NextResponse.json({ scheme });
}
