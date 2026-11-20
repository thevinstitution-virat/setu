import type { Tx } from "@/lib/db";
import { parseBrand } from "@/lib/branding";

/**
 * The set-up checklist a new business sees after sign-up (Phase 9).
 * Each step is "done" from the data itself, or ticked off / skipped by the
 * owner (Tenant.onboarding.steps[step] = "done" | "skipped").
 */

export const STEPS = [
  { key: "business", title: "Business and GST details", href: "/admin/settings", optional: false },
  { key: "brand", title: "Logo and colours", href: "/admin/settings/brand", optional: true },
  { key: "areas", title: "Regions and areas you serve", href: "/admin/regions", optional: false },
  { key: "products", title: "Products and prices", href: "/admin/import", optional: false },
  { key: "retailers", title: "Shops (retailers)", href: "/admin/import", optional: false },
  { key: "staff", title: "Invite staff", href: "/admin/team", optional: true },
  { key: "payments", title: "Online payments", href: "/admin/settings", optional: true },
  { key: "domain", title: "Your own web address", href: "/admin/settings/domains", optional: true },
] as const;

export type StepKey = (typeof STEPS)[number]["key"];
export const isStepKey = (v: unknown): v is StepKey => typeof v === "string" && STEPS.some((s) => s.key === v);

export type Checklist = {
  steps: { key: StepKey; title: string; href: string; optional: boolean; state: "done" | "skipped" | "todo"; detail?: string }[];
  done: number;
  total: number;
  dismissed: boolean;
};

export async function checklist(tx: Tx, tenantId: string): Promise<Checklist> {
  const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { gstin: true, stateCode: true, address: true, brand: true, settings: true, onboarding: true } });
  const ob = (t.onboarding ?? {}) as { steps?: Record<string, string>; dismissedAt?: string };
  const marks = ob.steps ?? {};
  const [areas, products, retailers, staff, domains] = await Promise.all([
    tx.area.count(),
    tx.product.count(),
    tx.retailerProfile.count(),
    tx.user.count({ where: { role: { in: ["SALES_AGENT", "DELIVERY_AGENT", "SUPERVISOR"] }, isSupport: false } }),
    tx.tenantDomain.count({ where: { tenantId, verifiedAt: { not: null } } }),
  ]);
  const brand = parseBrand(t.brand);
  const gw = ((t.settings ?? {}) as Record<string, unknown>).gateway as { provider?: string } | undefined;
  const auto: Record<StepKey, { done: boolean; detail?: string }> = {
    business: { done: !!(t.stateCode && t.address), detail: t.gstin ? `GSTIN ${t.gstin}` : undefined },
    brand: { done: !!(brand.logoKey || brand.primary || brand.accent) },
    areas: { done: areas > 0, detail: areas ? `${areas} areas` : undefined },
    products: { done: products > 0, detail: products ? `${products} products` : undefined },
    retailers: { done: retailers > 0, detail: retailers ? `${retailers} shops` : undefined },
    staff: { done: staff > 0, detail: staff ? `${staff} staff` : undefined },
    payments: { done: !!gw?.provider && gw.provider !== "none" },
    domain: { done: domains > 0 },
  };
  const steps = STEPS.map((s) => {
    const a = auto[s.key];
    const mark = marks[s.key];
    const state: "done" | "skipped" | "todo" = a.done || mark === "done" ? "done" : mark === "skipped" ? "skipped" : "todo";
    return { key: s.key, title: s.title, href: s.href, optional: s.optional, state, detail: a.detail };
  });
  return { steps, done: steps.filter((s) => s.state !== "todo").length, total: steps.length, dismissed: !!ob.dismissedAt };
}
