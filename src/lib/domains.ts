import { promises as dns } from "node:dns";
import { prisma } from "@/lib/prisma";
import { asPlatform } from "@/lib/db";
import { clearTenantCache, platformDomain } from "@/lib/tenant";

/**
 * Custom domains (Phase 9), e.g. order.agarwal.in for the "agarwal" tenant.
 *
 *  1. The owner adds the address; we give a token.
 *  2. They add two DNS records:
 *       TXT   _setu-verify.order.agarwal.in   = <token>
 *       CNAME order.agarwal.in                → <slug>.<PLATFORM_DOMAIN>   (or A → our server)
 *  3. "Check" looks the TXT up; a match marks the domain verified, and from
 *     then on lib/tenant.ts serves the tenant on that host.
 *  4. Certificates (automatic TLS):
 *       TLS_PROVIDER=caddy   — Caddy's on-demand TLS asks GET /api/platform/tls/ask?domain=<host>
 *                              (200 only for verified hosts), then gets the certificate itself.
 *       TLS_PROVIDER=coolify — we add the host to the Coolify app's domains through its API
 *                              (COOLIFY_API_URL, COOLIFY_API_TOKEN, COOLIFY_APP_UUID); Traefik
 *                              then gets a Let's Encrypt certificate.
 *       unset                — nothing automatic; the operator adds the domain by hand.
 */

export class DomainError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const HOST_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
export const MAX_DOMAINS = 3;

export function normaliseDomain(raw: string) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .replace(/\.$/, "");
}

/** null = fine; else why the host can't be used. Pure; exported for tests. */
export function domainProblem(host: string, domain = platformDomain()): string | null {
  if (!HOST_RE.test(host)) return "Enter an address like order.yourbusiness.in";
  if (host === domain || host.endsWith(`.${domain}`)) return "That is one of our own addresses. Use your business's domain.";
  if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/.test(host)) return "Use a public internet address";
  return null;
}

export const verifyName = (host: string) => `_setu-verify.${host}`;

export async function addDomain(tenantId: string, raw: string) {
  const host = normaliseDomain(raw);
  const problem = domainProblem(host);
  if (problem) throw new DomainError(problem);
  return asPlatform(async (tx) => {
    const n = await tx.tenantDomain.count({ where: { tenantId } });
    if (n >= MAX_DOMAINS) throw new DomainError(`At most ${MAX_DOMAINS} addresses. Remove one first.`);
    const taken = await tx.tenantDomain.findUnique({ where: { host } });
    if (taken) throw new DomainError(taken.tenantId === tenantId ? "You have added this address already" : "This address is used by another business", 409);
    return tx.tenantDomain.create({ data: { tenantId, host } });
  });
}

type Resolver = (name: string) => Promise<string[][]>;

/** Look the TXT record up and mark the domain verified on a match. */
export async function checkDomain(tenantId: string, id: string, resolveTxt: Resolver = dns.resolveTxt, now = new Date()) {
  const d = await asPlatform((tx) => tx.tenantDomain.findFirst({ where: { id, tenantId } }));
  if (!d) throw new DomainError("Address not found", 404);
  let found = false;
  let error: string | null = null;
  try {
    const records = await resolveTxt(verifyName(d.host));
    found = records.some((parts) => parts.join("").trim() === d.token);
    if (!found) error = `The TXT record at ${verifyName(d.host)} doesn't have the code yet. DNS changes can take up to an hour.`;
  } catch {
    error = `No TXT record found at ${verifyName(d.host)} yet. DNS changes can take up to an hour.`;
  }
  let tlsStatus = d.tlsStatus;
  if (found && !d.verifiedAt) tlsStatus = await requestCertificate(d.host);
  const row = await asPlatform((tx) =>
    tx.tenantDomain.update({
      where: { id: d.id },
      data: { checkedAt: now, lastError: found ? null : error, ...(found && !d.verifiedAt ? { verifiedAt: now, tlsStatus } : {}) },
    })
  );
  if (found) clearTenantCache();
  return row;
}

export async function removeDomain(tenantId: string, id: string) {
  const d = await asPlatform((tx) => tx.tenantDomain.findFirst({ where: { id, tenantId } }));
  if (!d) throw new DomainError("Address not found", 404);
  await asPlatform((tx) => tx.tenantDomain.delete({ where: { id: d.id } }));
  clearTenantCache();
  return d;
}

/** For Caddy's on-demand TLS: may we get a certificate for this host? */
export async function tlsAllowed(host: string) {
  const h = normaliseDomain(host);
  const domain = platformDomain();
  if (h === domain || h.endsWith(`.${domain}`)) {
    const sub = h === domain ? "" : h.slice(0, -(domain.length + 1));
    if (!sub || sub === "www" || sub === "platform") return true;
    const t = await prisma.tenant.findUnique({ where: { slug: sub }, select: { status: true } });
    return !!t && t.status !== "CLOSED";
  }
  const d = await prisma.tenantDomain.findUnique({ where: { host: h }, select: { verifiedAt: true } });
  return !!d?.verifiedAt;
}

/** Ask the proxy for a certificate. Never throws; returns a status line kept on the domain. */
export async function requestCertificate(host: string): Promise<string> {
  const provider = process.env.TLS_PROVIDER;
  if (provider === "caddy") return "caddy: issued on first visit";
  if (provider !== "coolify") return "manual: add the domain to the proxy";
  const base = process.env.COOLIFY_API_URL;
  const tokenValue = process.env.COOLIFY_API_TOKEN;
  const app = process.env.COOLIFY_APP_UUID;
  if (!base || !tokenValue || !app) return "coolify: not configured";
  try {
    const headers = { Authorization: `Bearer ${tokenValue}`, "Content-Type": "application/json" };
    const cur = await fetch(`${base.replace(/\/$/, "")}/api/v1/applications/${app}`, { headers, signal: AbortSignal.timeout(10_000) });
    if (!cur.ok) return `coolify: read failed (${cur.status})`;
    const appJson = (await cur.json()) as { fqdn?: string | null };
    const list = (appJson.fqdn ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    const url = `https://${host}`;
    if (list.includes(url)) return "coolify: already listed";
    const res = await fetch(`${base.replace(/\/$/, "")}/api/v1/applications/${app}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ domains: [...list, url].join(",") }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok ? "coolify: added, certificate on first visit" : `coolify: update failed (${res.status})`;
  } catch {
    return "coolify: not reachable";
  }
}

export type DomainRow = { id: string; host: string; token: string; verifiedAt: Date | null; checkedAt: Date | null; lastError: string | null; tlsStatus: string | null; createdAt: Date };

export function domainView(d: DomainRow, slug: string) {
  return {
    id: d.id,
    host: d.host,
    verified: !!d.verifiedAt,
    verifiedAt: d.verifiedAt,
    checkedAt: d.checkedAt,
    lastError: d.lastError,
    tlsStatus: d.tlsStatus,
    records: [
      { type: "TXT", name: verifyName(d.host), value: d.token },
      { type: "CNAME", name: d.host, value: `${slug}.${platformDomain()}` },
    ],
  };
}

