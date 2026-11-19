import { asPlatform, type Tx } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Plans, modules and usage limits (Phase 9).
 *
 * A tenant's entitlements = its plan's modules and limits, with the
 * platform's per-tenant overrides on top (Tenant.overrides). During the trial
 * a tenant gets the modules of the plan it is trying (the "trial" plan unless
 * it picked one).
 *
 * Modules are checked in one place: guard() maps the request path to a module
 * (featureForPath) so a route never forgets the check; screens hide the nav
 * item and show an upgrade card.
 */

export const FEATURES = {
  inventory: "Stock, batches, purchase orders and van stock",
  field: "Supervisors, targets, beat plans and new shops from the field",
  engage: "Announcements and refer and earn",
  gateway: "Online payments (payment links and UPI QR)",
  bank: "Bank statement import and matching",
  integrations: "API keys and webhooks for the business's own software",
  whiteLabel: "Own logo, colours and app name",
  customDomain: "Own web address (custom domain)",
  android: "Own Android app (branded build)",
  ai: "AI assistants (when they ship)",
} as const;

export type Feature = keyof typeof FEATURES;
export const FEATURE_KEYS = Object.keys(FEATURES) as Feature[];
export const isFeature = (v: unknown): v is Feature => typeof v === "string" && v in FEATURES;

export type LimitKey = "staff" | "retailers";
export type Limits = Partial<Record<LimitKey, number>>;

/**
 * The plans the seed and a fresh platform start with. Prices are placeholders
 * the platform owner sets in the console (Plans); nothing reads these at run
 * time except the seed and tests.
 */
export const DEFAULT_PLANS = [
  {
    code: "trial",
    name: "Free trial",
    basePaise: 0,
    seatPaise: 0,
    retailerPaise: 0,
    aiCredits: 100,
    aiCreditPaise: 0,
    features: ["inventory", "field", "engage", "gateway", "bank", "integrations", "whiteLabel"],
    limits: { staff: 10, retailers: 200 },
    trialDays: 14,
    public: false,
    sortOrder: 0,
  },
  {
    code: "starter",
    name: "Starter",
    basePaise: 99_900,
    seatPaise: 9_900,
    retailerPaise: 500,
    aiCredits: 0,
    aiCreditPaise: 100,
    features: ["gateway", "bank"],
    limits: { staff: 10, retailers: 300 },
    trialDays: 14,
    public: true,
    sortOrder: 1,
  },
  {
    code: "growth",
    name: "Growth",
    basePaise: 2_49_900,
    seatPaise: 14_900,
    retailerPaise: 400,
    aiCredits: 500,
    aiCreditPaise: 80,
    features: ["inventory", "field", "engage", "gateway", "bank", "integrations", "whiteLabel"],
    limits: { staff: 50, retailers: 3000 },
    trialDays: 14,
    public: true,
    sortOrder: 2,
  },
  {
    code: "premium",
    name: "Premium",
    basePaise: 6_99_900,
    seatPaise: 12_900,
    retailerPaise: 300,
    aiCredits: 3000,
    aiCreditPaise: 60,
    features: [...FEATURE_KEYS],
    limits: { staff: 500, retailers: 50000 },
    trialDays: 14,
    public: true,
    sortOrder: 3,
  },
] as const;

export type Overrides = { features?: Partial<Record<Feature, boolean>>; limits?: Limits };

export function parseOverrides(v: unknown): Overrides {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const out: Overrides = {};
  if (o.features && typeof o.features === "object") {
    const f: Partial<Record<Feature, boolean>> = {};
    for (const [k, val] of Object.entries(o.features as Record<string, unknown>)) if (isFeature(k) && typeof val === "boolean") f[k] = val;
    out.features = f;
  }
  out.limits = parseLimits(o.limits);
  return out;
}

export function parseLimits(v: unknown): Limits {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const out: Limits = {};
  for (const k of ["staff", "retailers"] as const) {
    const n = Number(o[k]);
    if (o[k] !== undefined && o[k] !== null && Number.isInteger(n) && n >= 0) out[k] = n;
  }
  return out;
}

export type Entitlements = {
  planCode: string;
  planName: string;
  status: string;
  trialEndsAt: Date | null;
  features: Set<Feature>;
  limits: Limits;
};

/** Pure merge of a plan and overrides. Exported for tests. */
export function mergeEntitlements(
  plan: { code: string; name: string; features: string[]; limits: unknown },
  overrides: Overrides,
  sub: { status: string; trialEndsAt: Date | null } = { status: "ACTIVE", trialEndsAt: null }
): Entitlements {
  const features = new Set(plan.features.filter(isFeature));
  for (const [k, on] of Object.entries(overrides.features ?? {})) {
    if (on) features.add(k as Feature);
    else features.delete(k as Feature);
  }
  return {
    planCode: plan.code,
    planName: plan.name,
    status: sub.status,
    trialEndsAt: sub.trialEndsAt,
    features,
    limits: { ...parseLimits(plan.limits), ...(overrides.limits ?? {}) },
  };
}

const TTL_MS = 60_000;
const cache = new Map<string, { e: Entitlements; at: number }>();

export function invalidateEntitlements(tenantId?: string) {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}

/**
 * What a tenant may use now. A tenant without a subscription row (made
 * before Phase 9, or by the CLI) is treated as on its Tenant.plan code, or
 * "trial" — never locked out by a missing row.
 */
export async function entitlements(tenantId: string, tx?: Tx): Promise<Entitlements> {
  const hit = cache.get(tenantId);
  if (!tx && hit && Date.now() - hit.at < TTL_MS) return hit.e;
  const run = async (t: Tx) => {
    const tenant = await t.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { plan: true, overrides: true } });
    const sub = await t.subscription.findUnique({ where: { tenantId }, select: { status: true, trialEndsAt: true, planCode: true, nextPlanCode: true } });
    // In a trial the business tries the plan it picked (if any).
    const code = sub ? (sub.status === "TRIAL" && sub.nextPlanCode ? sub.nextPlanCode : sub.planCode) : tenant.plan;
    const plan =
      (await t.plan.findUnique({ where: { code } })) ??
      (await t.plan.findUnique({ where: { code: "trial" } })) ??
      { code: "trial", name: "Free trial", features: [...DEFAULT_PLANS[0].features], limits: DEFAULT_PLANS[0].limits };
    return mergeEntitlements(plan, parseOverrides(tenant.overrides), sub ?? { status: "ACTIVE", trialEndsAt: null });
  };
  const e = tx ? await run(tx) : await asPlatform(run);
  cache.set(tenantId, { e, at: Date.now() });
  return e;
}

export async function hasFeature(tenantId: string, f: Feature) {
  return (await entitlements(tenantId)).features.has(f);
}

/**
 * Which module a request path belongs to (pages and API). null = core,
 * always on. Webhooks from the gateway are never gated: a payment made
 * before a downgrade must still be booked.
 */
export const PATH_FEATURES: [string, Feature][] = [
  ["/api/stock", "inventory"],
  ["/api/purchase-orders", "inventory"],
  ["/api/purchases", "inventory"],
  ["/api/suppliers", "inventory"],
  ["/admin/stock", "inventory"],
  ["/api/team", "field"],
  ["/api/targets", "field"],
  ["/api/beat-plans", "field"],
  ["/api/leads", "field"],
  ["/team", "field"],
  ["/api/announcements", "engage"],
  ["/api/referrals", "engage"],
  ["/admin/engage", "engage"],
  ["/api/pay-requests", "gateway"],
  ["/api/admin/settings/gateway", "gateway"],
  ["/api/bank", "bank"],
  ["/admin/bank", "bank"],
  ["/api/v1", "integrations"],
  ["/api/admin/api-keys", "integrations"],
  ["/api/admin/webhooks", "integrations"],
  ["/api/admin/integrations", "integrations"],
  ["/admin/integrations", "integrations"],
  ["/api/admin/domains", "customDomain"],
];

export function featureForPath(pathname: string): Feature | null {
  for (const [prefix, f] of PATH_FEATURES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return f;
  }
  return null;
}

// ───────────────────────────── usage limits ─────────────────────────────

export class LimitError extends Error {
  constructor(
    public kind: LimitKey,
    public limit: number,
    public used: number
  ) {
    super(
      kind === "staff"
        ? `Your plan allows ${limit} staff logins and ${used} are in use. Deactivate someone or move to a bigger plan.`
        : `Your plan allows ${limit} shops and ${used} are active. Move to a bigger plan to add more.`
    );
  }
}

/** Staff seats: active logins that are not retailers and not the platform's support login. */
/** Anything that can count users: a transaction or the tenant client. */
export type UserCounter = { user: { count(args: { where: Prisma.UserWhereInput }): Promise<number> } };
export const countSeats = (tx: UserCounter) => tx.user.count({ where: { active: true, isSupport: false, role: { not: "RETAILER" } } });
/** Shops on the books: active retailer logins. */
export const countRetailers = (tx: UserCounter) => tx.user.count({ where: { active: true, role: "RETAILER" } });

/**
 * Throw LimitError when adding `adding` more would go over the plan. Call
 * inside the tenant transaction that creates the rows (tx is tenant-scoped).
 */
export async function checkLimit(tx: UserCounter, tenantId: string, kind: LimitKey, adding = 1) {
  if (adding <= 0) return;
  const e = await entitlements(tenantId);
  const limit = e.limits[kind];
  if (limit === undefined) return;
  const used = kind === "staff" ? await countSeats(tx) : await countRetailers(tx);
  if (used + adding > limit) throw new LimitError(kind, limit, used);
}
