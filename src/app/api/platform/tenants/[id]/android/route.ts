import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { platformGuard } from "@/lib/platform-auth";
import { entitlements } from "@/lib/plans";
import { androidKit } from "@/lib/android-kit";

/** Build settings for the business's own Android app (plans with the android module). */
export async function GET(_req: Request, ctx: RouteContext<"/api/platform/tenants/[id]/android">) {
  const g = await platformGuard();
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  const t = await prisma.tenant.findUnique({ where: { id }, select: { slug: true, name: true, brand: true, status: true, domains: { where: { verifiedAt: { not: null } }, take: 1, select: { host: true } } } });
  if (!t || t.status === "CLOSED") return NextResponse.json({ error: "Business not found" }, { status: 404 });
  const allowed = (await entitlements(id)).features.has("android");
  return NextResponse.json({ allowed, kit: androidKit(t, t.domains[0]?.host ?? null) });
}
