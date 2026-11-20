import type { TenantDb } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

type AuditInput = {
  actorId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
};

function json(v: unknown): Prisma.InputJsonValue | undefined {
  if (v === undefined || v === null) return undefined;
  return JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
}

/**
 * Append an audit entry. Never throws: a failed audit write is logged but
 * must not break the business action that triggered it.
 */
export async function audit(db: TenantDb, entry: AuditInput) {
  try {
    await db.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        before: json(entry.before),
        after: json(entry.after),
        ip: entry.ip ?? null,
      },
    });
  } catch (e) {
    console.error("[audit] failed to write", entry.action, e);
  }
}

/**
 * The client's address. X-Forwarded-For is "what the client claimed, …,
 * what each proxy saw": only the entries added by our own proxies can be
 * trusted, so read from the right. TRUST_PROXY_HOPS = how many proxies sit in
 * front of the app (1: Coolify's Traefik; 2: a CDN in front of it). Next
 * fills the header with the socket address when nothing is in front.
 */
export function clientIp(xff: string | null, realIp: string | null, hops = Number(process.env.TRUST_PROXY_HOPS || 1)): string | null {
  const list = (xff ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const n = Number.isInteger(hops) && hops > 0 ? hops : 1;
  const ip = list.length ? list[Math.max(0, list.length - n)] : realIp?.trim() || null;
  return ip ? ip.slice(0, 64) : null;
}

export function requestIp(req: Request): string | null {
  return clientIp(req.headers.get("x-forwarded-for"), req.headers.get("x-real-ip"));
}
