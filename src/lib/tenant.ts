import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { tenantDb, type TenantDb } from "@/lib/db";

/**
 * Tenant resolution from the request host.
 *
 *   <slug>.<PLATFORM_DOMAIN>     → tenant by slug      (e.g. agarwal.sellerssetu.in)
 *   verified custom domain       → tenant by TenantDomain (e.g. order.agarwal.in)
 *   <PLATFORM_DOMAIN> itself     → no tenant (platform marketing site), unless
 *                                  DEFAULT_TENANT_SLUG is set (local dev)
 *
 * Local dev: PLATFORM_DOMAIN=localhost, so http://demo.localhost:3100 is the
 * "demo" tenant; browsers resolve *.localhost to 127.0.0.1 automatically.
 */

export type CurrentTenant = {
  id: string;
  slug: string;
  name: string;
  status: "TRIAL" | "ACTIVE" | "SUSPENDED" | "CLOSED";
  brand: Record<string, unknown>;
  settings: Record<string, unknown>;
  /** Why the business is paused (billing:..., or the platform's note). */
  suspendReason: string | null;
  /** When a requested deletion will run. */
  deleteAfter: Date | null;
};

const RESERVED = new Set(["www", "app", "api", "admin", "platform", "static", "cdn", "mail"]);
const TTL_MS = 60_000;
const cache = new Map<string, { tenant: CurrentTenant | null; at: number }>();

export function platformDomain() {
  return (process.env.PLATFORM_DOMAIN ?? "localhost").toLowerCase();
}

export function normaliseHost(raw: string | null | undefined): string {
  return (raw ?? "").split(",")[0].trim().split(":")[0].toLowerCase();
}

/** Pure host → lookup key. Exported for tests. */
export function classifyHost(
  host: string,
  domain = platformDomain(),
  /** null = no default tenant (pass null in tests; undefined would read the env). */
  defaultSlug: string | null = process.env.DEFAULT_TENANT_SLUG || null
): { kind: "slug"; slug: string } | { kind: "custom"; host: string } | { kind: "platform" } {
  if (!host || host === domain || host === `www.${domain}` || host === "127.0.0.1" || host === "[::1]") {
    return defaultSlug ? { kind: "slug", slug: defaultSlug } : { kind: "platform" };
  }
  if (host.endsWith(`.${domain}`)) {
    const sub = host.slice(0, -(domain.length + 1));
    if (!sub || sub.includes(".") || RESERVED.has(sub)) return { kind: "platform" };
    return { kind: "slug", slug: sub };
  }
  return { kind: "custom", host };
}

function toCurrent(t: {
  id: string;
  slug: string;
  name: string;
  status: CurrentTenant["status"];
  brand: unknown;
  settings: unknown;
  suspendReason?: string | null;
  deleteAfter?: Date | null;
}): CurrentTenant {
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    status: t.status,
    brand: (t.brand ?? {}) as Record<string, unknown>,
    settings: (t.settings ?? {}) as Record<string, unknown>,
    suspendReason: t.suspendReason ?? null,
    deleteAfter: t.deleteAfter ?? null,
  };
}

/** Forget cached lookups for a tenant after its settings or brand change. */
export function invalidateTenantCache(tenantId: string) {
  for (const [host, v] of cache) if (v.tenant?.id === tenantId) cache.delete(host);
}

export async function resolveTenantByHost(host: string): Promise<CurrentTenant | null> {
  const hit = cache.get(host);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.tenant;

  const c = classifyHost(host);
  let tenant: CurrentTenant | null = null;
  if (c.kind === "slug") {
    const t = await prisma.tenant.findUnique({ where: { slug: c.slug } });
    tenant = t ? toCurrent(t) : null;
  } else if (c.kind === "custom") {
    const d = await prisma.tenantDomain.findUnique({ where: { host: c.host }, include: { tenant: true } });
    tenant = d?.verifiedAt ? toCurrent(d.tenant) : null;
  }
  // A paused (SUSPENDED) business still resolves, so its owner can sign in to
  // pay or export; guard() lets nobody else through. A closed one is gone.
  if (tenant?.status === "CLOSED") tenant = null;

  cache.set(host, { tenant, at: Date.now() });
  return tenant;
}

export function clearTenantCache() {
  cache.clear();
}

/** The tenant for the current request, or null on the platform site. */
export async function getTenant(): Promise<CurrentTenant | null> {
  const h = await headers();
  return resolveTenantByHost(normaliseHost(h.get("x-forwarded-host") ?? h.get("host")));
}

export class NoTenantError extends Error {
  constructor() {
    super("No tenant for this address");
  }
}

export async function requireTenant(): Promise<CurrentTenant> {
  const t = await getTenant();
  if (!t) throw new NoTenantError();
  return t;
}

/** Row-level-security scoped database client for the current request's tenant. */
export async function getDb(): Promise<TenantDb> {
  const t = await requireTenant();
  return tenantDb(t.id);
}
