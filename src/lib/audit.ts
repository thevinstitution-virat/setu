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

export function requestIp(req: Request): string | null {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    null
  );
}
