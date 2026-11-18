import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { bad, parseScheme } from "@/lib/catalogue-api";
import { describeScheme } from "@/lib/schemes";

/** Every scheme with its summary and usage. */
export async function GET() {
  const auth = await guard("pricing.manage");
  if (!auth.ok) return auth.res;
  const [schemes, uses] = await Promise.all([
    auth.db.scheme.findMany({ orderBy: [{ active: "desc" }, { priority: "asc" }, { createdAt: "desc" }] }),
    auth.db.schemeRedemption.groupBy({ by: ["schemeId"], where: { reversed: false }, _count: { _all: true }, _sum: { freeQty: true } }),
  ]);
  const u = new Map(uses.map((x) => [x.schemeId, x]));
  const freeIds = schemes.map((s) => (s.params as { freeProductId?: string | null }).freeProductId).filter((x): x is string => !!x);
  const freeNames = new Map(
    freeIds.length ? (await auth.db.product.findMany({ where: { id: { in: freeIds } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]) : []
  );
  const now = new Date();
  return NextResponse.json({
    schemes: schemes.map((s) => ({
      ...s,
      summary: describeScheme(s.type, s.params, freeNames.get((s.params as { freeProductId?: string }).freeProductId ?? "") ?? null),
      orders: u.get(s.id)?._count._all ?? 0,
      freeQty: u.get(s.id)?._sum.freeQty ?? 0,
      state: !s.active ? "off" : s.endsAt && s.endsAt < now ? "ended" : s.startsAt && s.startsAt > now ? "upcoming" : s.budget !== null && s.spent >= s.budget ? "budget_used" : "running",
    })),
  });
}

export async function POST(req: Request) {
  const auth = await guard("pricing.manage");
  if (!auth.ok) return auth.res;
  const { db, session } = auth;
  const b = (await req.json().catch(() => null)) ?? {};
  const data = await parseScheme(db, b, null);
  if (typeof data === "string") return bad(data);
  if (data.couponCode && (await db.scheme.findFirst({ where: { couponCode: data.couponCode as string } }))) return bad("That coupon code is already used", 409);
  const scheme = await db.scheme.create({ data: data as never });
  await audit(db, { actorId: session.userId, action: "scheme.create", entity: "Scheme", entityId: scheme.id, after: scheme, ip: requestIp(req) });
  return NextResponse.json({ scheme });
}
