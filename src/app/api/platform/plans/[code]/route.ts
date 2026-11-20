import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requestIp } from "@/lib/audit";
import { platformAudit, platformGuard } from "@/lib/platform-auth";
import { invalidateEntitlements } from "@/lib/plans";
import { planData } from "@/lib/plan-admin";

/** Edit a plan (OWNER). Price changes apply from the next invoice of every business on it. */
export async function PATCH(req: Request, ctx: RouteContext<"/api/platform/plans/[code]">) {
  const g = await platformGuard("OWNER");
  if (!g.ok) return g.res;
  const { code } = await ctx.params;
  const cur = await prisma.plan.findUnique({ where: { code } });
  if (!cur) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const p = planData(body ?? {}, false);
  if (p.error) return NextResponse.json({ error: p.error }, { status: 400 });
  const plan = await prisma.plan.update({ where: { code }, data: p.data! });
  invalidateEntitlements();
  await platformAudit(g.session.platformUserId, "plan.update", { detail: { code, before: cur, after: plan } as never, ip: requestIp(req) });
  return NextResponse.json(plan);
}
