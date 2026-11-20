import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTenant } from "@/lib/tenant";
import { FEATURES, isFeature, parseLimits } from "@/lib/plans";

/** Plans on offer for the sign-up page. */
export async function GET() {
  if (await getTenant()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [plans, trial] = await Promise.all([
    prisma.plan.findMany({ where: { active: true, public: true }, orderBy: { sortOrder: "asc" } }),
    prisma.plan.findUnique({ where: { code: "trial" }, select: { trialDays: true } }),
  ]);
  return NextResponse.json({
    trialDays: trial?.trialDays ?? 14,
    plans: plans.map((p) => ({
      code: p.code,
      name: p.name,
      basePaise: p.basePaise,
      seatPaise: p.seatPaise,
      retailerPaise: p.retailerPaise,
      aiCredits: p.aiCredits,
      limits: parseLimits(p.limits),
      features: p.features.filter(isFeature).map((f) => ({ code: f, label: FEATURES[f] })),
    })),
  });
}
