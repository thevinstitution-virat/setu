import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { asPlatform } from "@/lib/db";
import { requestIp } from "@/lib/audit";
import { platformAudit, platformGuard } from "@/lib/platform-auth";
import { FEATURES } from "@/lib/plans";
import { planData } from "@/lib/plan-admin";

export async function GET() {
  const g = await platformGuard();
  if (!g.ok) return g.res;
  // asPlatform: counting subscriptions reads per-business rows (row-level security).
  const plans = await asPlatform((tx) => tx.plan.findMany({ orderBy: { sortOrder: "asc" }, include: { _count: { select: { subscriptions: true } } } }));
  return NextResponse.json({ plans, features: FEATURES });
}

/** New plan (OWNER). Body: code, name, prices in paise, features[], limits{staff,retailers}, trialDays, public. */
export async function POST(req: Request) {
  const g = await platformGuard("OWNER");
  if (!g.ok) return g.res;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const code = typeof body?.code === "string" ? body.code.trim().toLowerCase() : "";
  if (!/^[a-z][a-z0-9-]{1,19}$/.test(code)) return NextResponse.json({ error: "Code: 2–20 small letters, digits or dashes" }, { status: 400 });
  const p = planData(body ?? {}, true);
  if (p.error) return NextResponse.json({ error: p.error }, { status: 400 });
  if (await prisma.plan.findUnique({ where: { code } })) return NextResponse.json({ error: "A plan with this code exists" }, { status: 409 });
  const plan = await prisma.plan.create({ data: { ...p.data!, code } });
  await platformAudit(g.session.platformUserId, "plan.create", { detail: { code }, ip: requestIp(req) });
  return NextResponse.json(plan, { status: 201 });
}

