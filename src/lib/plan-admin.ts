import type { Prisma } from "@/generated/prisma/client";
import { FEATURES, isFeature, parseLimits } from "@/lib/plans";

/** Parse a plan from the console (shared by create and edit). null fields stay as they are. */
export function planData(b: Record<string, unknown>, creating: boolean): { data?: Prisma.PlanUncheckedCreateInput; error?: string } {
  const out: Record<string, unknown> = {};
  if (creating || "name" in b) {
    const name = typeof b.name === "string" ? b.name.trim() : "";
    if (name.length < 2 || name.length > 40) return { error: "Name: 2–40 characters" };
    out.name = name;
  }
  for (const k of ["basePaise", "seatPaise", "retailerPaise", "aiCredits", "aiCreditPaise", "trialDays", "sortOrder"] as const) {
    if (!(k in b)) continue;
    const n = Number(b[k]);
    if (!Number.isInteger(n) || n < 0 || n > 100_000_00) return { error: `${k} must be a whole number (paise for prices)` };
    if (k === "trialDays" && n > 90) return { error: "Trial: at most 90 days" };
    out[k] = n;
  }
  if ("features" in b) {
    if (!Array.isArray(b.features) || !b.features.every(isFeature)) return { error: `Modules are: ${Object.keys(FEATURES).join(", ")}` };
    out.features = [...new Set(b.features)];
  }
  if ("limits" in b) out.limits = parseLimits(b.limits);
  for (const k of ["public", "active"] as const) if (typeof b[k] === "boolean") out[k] = b[k];
  return { data: out as Prisma.PlanUncheckedCreateInput };
}
