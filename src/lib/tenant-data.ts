import { gzipSync } from "node:zlib";
import { prisma } from "@/lib/prisma";
import { asPlatform, withTenantTx, type Tx } from "@/lib/db";
import { deleteFile, deleteTenantFiles, putFile } from "@/lib/storage";
import { clearTenantCache } from "@/lib/tenant";
import { invalidateEntitlements } from "@/lib/plans";
import { emit } from "@/lib/jobs";

/**
 * A tenant's whole data set (Phase 9, DPDP Act): export and deletion.
 *
 * Tables are found from the database itself (every table with a "tenantId"
 * column), so a table added in a later phase is exported and purged without
 * anyone remembering to list it here.
 *
 * Export: one gzipped JSON file { format, exportedAt, tenant, tables: { Table: [rows] } }
 *   — secrets left out (password hashes, API key hashes, webhook secrets,
 *     push keys, OTP codes, gateway secrets).
 *
 * Purge: one transaction with app.purge_tenant set (the only way the
 *   append-only ledger / audit / stock history and the immutable invoices of
 *   that one tenant can be deleted — see the saas_platform migration), rows
 *   deleted children-first, then the tenant's files. The Tenant row stays as
 *   a tombstone (status CLOSED, data cleared) because our own invoices to it
 *   (PlatformInvoice) must be kept; Subscription and UsageCounter stay too.
 */

/** Our own records about the tenant, kept after a purge. */
export const KEEP_AFTER_PURGE = new Set(["PlatformInvoice", "Subscription", "UsageCounter"]);
/** Tables not worth exporting (codes, tokens, caches). */
const SKIP_EXPORT = new Set(["OtpChallenge", "EmailChallenge", "HandoffUse", "GeoCache", "TenantExport", "SupportSession"]);
/** Columns never exported. */
const REDACT: Record<string, string[]> = {
  User: ["passwordHash"],
  ApiKey: ["hash"],
  WebhookEndpoint: ["secret"],
  PushSubscription: ["p256dh", "auth", "endpoint"],
};
const SECRETISH = /secret|password|token|keyId|apiKey/i;

const ident = (t: string) => {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(t)) throw new Error(`Bad table name ${t}`);
  return `"${t}"`;
};

/** Every table with a tenantId column. */
export async function tenantTables(tx: Pick<Tx, "$queryRawUnsafe"> = prisma): Promise<string[]> {
  const rows = await tx.$queryRawUnsafe<{ t: string }[]>(
    `SELECT c.relname AS t FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema() AND c.relkind = 'r' AND a.attname = 'tenantId' AND NOT a.attisdropped
      ORDER BY c.relname`
  );
  return rows.map((r) => r.t);
}

type Fk = { child: string; parent: string; cols: string[]; nullable: boolean; onDelete: string };

async function foreignKeys(tx: Pick<Tx, "$queryRawUnsafe">): Promise<Fk[]> {
  const rows = await tx.$queryRawUnsafe<{ child: string; parent: string; cols: string[]; nullable: boolean; ondelete: string }[]>(
    `SELECT cl.relname AS child, pr.relname AS parent,
            array_agg(att.attname::text ORDER BY k.ord) AS cols,
            bool_and(NOT att.attnotnull) AS nullable,
            con.confdeltype::text AS ondelete
       FROM pg_constraint con
       JOIN pg_class cl ON cl.oid = con.conrelid
       JOIN pg_class pr ON pr.oid = con.confrelid
       JOIN pg_namespace n ON n.oid = cl.relnamespace
       CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
       JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
      WHERE con.contype = 'f' AND n.nspname = current_schema()
      GROUP BY cl.relname, pr.relname, con.conname, con.confdeltype`
  );
  return rows.map((r) => ({ child: r.child, parent: r.parent, cols: r.cols, nullable: r.nullable, onDelete: r.ondelete }));
}

/**
 * Children-first delete order (pure; exported for tests). FKs the database
 * resolves itself (CASCADE / SET NULL) don't constrain the order. When only
 * cycles are left, nullable FK columns inside them are listed to be set to
 * NULL first.
 */
export function purgePlan(tables: string[], fks: Fk[]): { order: string[]; nullify: { table: string; cols: string[] }[] } {
  const set = new Set(tables);
  let edges = fks.filter((f) => set.has(f.child) && set.has(f.parent) && (f.onDelete === "a" || f.onDelete === "r"));
  const nullify: { table: string; cols: string[] }[] = [];
  // Self references can't be ordered: clear them first.
  for (const f of edges.filter((e) => e.child === e.parent)) {
    if (!f.nullable) throw new Error(`Can't purge ${f.child}: required self reference ${f.cols.join(",")}`);
    nullify.push({ table: f.child, cols: f.cols });
  }
  edges = edges.filter((e) => e.child !== e.parent);
  const order: string[] = [];
  const left = new Set(tables);
  while (left.size) {
    // A table can go when no remaining table still points at it.
    const ready = [...left].filter((t) => !edges.some((e) => e.parent === t && left.has(e.child)));
    if (ready.length) {
      for (const t of ready.sort()) {
        order.push(t);
        left.delete(t);
      }
      continue;
    }
    const cut = edges.find((e) => left.has(e.child) && left.has(e.parent) && e.nullable);
    if (!cut) throw new Error(`Can't order the purge: cycle among ${[...left].join(", ")}`);
    nullify.push({ table: cut.child, cols: cut.cols });
    edges = edges.filter((e) => e !== cut);
  }
  return { order, nullify };
}

const scrubSettings = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(scrubSettings);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) out[k] = SECRETISH.test(k) ? "[removed]" : scrubSettings(val);
    return out;
  }
  return v;
};

/** Build the export file for one tenant (in a repeatable-read snapshot). */
export async function buildExport(tenantId: string, now = new Date()) {
  const tables = (await tenantTables()).filter((t) => !SKIP_EXPORT.has(t));
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      const out: Record<string, unknown[]> = {};
      let rows = 0;
      for (const t of tables) {
        const list = await tx.$queryRawUnsafe<{ j: Record<string, unknown> }[]>(`SELECT row_to_json(x) AS j FROM ${ident(t)} x WHERE x."tenantId" = $1`, tenantId);
        const drop = REDACT[t] ?? [];
        out[t] = list.map(({ j }) => {
          for (const c of drop) delete j[c];
          return j;
        });
        rows += list.length;
      }
      const doc = {
        format: "setu-export/1",
        exportedAt: now.toISOString(),
        tenant: { ...tenant, settings: scrubSettings(tenant.settings), overrides: undefined },
        tables: out,
      };
      return { bytes: gzipSync(Buffer.from(JSON.stringify(doc))), rows };
    },
    { isolationLevel: "RepeatableRead", timeout: 120_000 }
  );
}

export const EXPORT_DAYS = 7;

/** Run a queued export (worker job, or inline in tests). */
export async function runExport(tenantId: string, exportId: string, now = new Date()) {
  const claimed = await withTenantTx(tenantId, (tx) => tx.tenantExport.updateMany({ where: { id: exportId, status: "QUEUED" }, data: { status: "RUNNING" } }));
  if (claimed.count !== 1) return null;
  try {
    const { bytes, rows } = await buildExport(tenantId, now);
    const key = `t/${tenantId}/export/${exportId}.json.gz`;
    await putFile(key, bytes, "application/gzip");
    return await withTenantTx(tenantId, (tx) =>
      tx.tenantExport.update({ where: { id: exportId }, data: { status: "READY", fileKey: key, bytes: bytes.length, rows, readyAt: now, expiresAt: new Date(now.getTime() + EXPORT_DAYS * 86_400_000) } })
    );
  } catch (e) {
    await withTenantTx(tenantId, (tx) => tx.tenantExport.update({ where: { id: exportId }, data: { status: "FAILED", error: String((e as Error)?.message ?? e).slice(0, 500) } }));
    throw e;
  }
}

/** Queue an export for the worker; without a queue (JOBS_DISABLED, dev) make it now. */
export async function queueExport(tenantId: string, exportId: string) {
  if (await emit("tenant.export", { tenantId, exportId })) return;
  await runExport(tenantId, exportId).catch((e) => console.error("[export] failed", e));
}

export class LifecycleError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** Delete every row of a tenant except our own records; leave a CLOSED tombstone. */
export async function purgeTenant(tenantId: string, now = new Date()) {
  const counts: Record<string, number> = {};
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', TRUE)`;
      await tx.$executeRaw`SELECT set_config('app.purge_tenant', ${tenantId}, TRUE)`;
      const t = await tx.tenant.findUnique({ where: { id: tenantId }, select: { status: true } });
      if (!t) throw new LifecycleError("Business not found", 404);
      const tables = (await tenantTables(tx)).filter((x) => !KEEP_AFTER_PURGE.has(x));
      const plan = purgePlan(tables, await foreignKeys(tx));
      for (const n of plan.nullify) {
        const sets = n.cols.map((c) => `${ident(c)} = NULL`).join(", ");
        const any = n.cols.map((c) => `${ident(c)} IS NOT NULL`).join(" OR ");
        await tx.$executeRawUnsafe(`UPDATE ${ident(n.table)} SET ${sets} WHERE "tenantId" = $1 AND (${any})`, tenantId);
      }
      for (const table of plan.order) {
        counts[table] = await tx.$executeRawUnsafe(`DELETE FROM ${ident(table)} WHERE "tenantId" = $1`, tenantId);
      }
      await tx.tenantDomain.deleteMany({ where: { tenantId } });
      await tx.subscription.updateMany({ where: { tenantId }, data: { status: "CANCELLED", cancelAt: now } });
      await tx.tenant.update({
        where: { id: tenantId },
        data: {
          status: "CLOSED",
          closedAt: now,
          slug: `closed-${tenantId.slice(-10)}`,
          phone: null,
          address: null,
          brand: {},
          settings: {},
          overrides: {},
          onboarding: {},
        },
      });
    },
    { timeout: 300_000 }
  );
  const files = await deleteTenantFiles(tenantId).catch(() => 0);
  clearTenantCache();
  invalidateEntitlements(tenantId);
  return { counts, files };
}

const DELETE_GRACE_DAYS = 7;

/**
 * The owner asks to delete the business: a final export is made at once and
 * the purge runs after DELETE_GRACE_DAYS, unless cancelled.
 */
export async function requestDeletion(tenantId: string, by: string, now = new Date()) {
  const after = new Date(now.getTime() + DELETE_GRACE_DAYS * 86_400_000);
  const exp = await withTenantTx(tenantId, async (tx) => {
    const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { deleteAfter: true } });
    if (t.deleteAfter) throw new LifecycleError("Deletion is already scheduled");
    await tx.tenant.update({ where: { id: tenantId }, data: { deleteRequestedAt: now, deleteAfter: after } });
    await tx.auditLog.create({ data: { actorId: by.startsWith("platform:") ? null : by, action: "tenant.delete_requested", entity: "Tenant", entityId: tenantId, after: { deleteAfter: after.toISOString(), by } } });
    return tx.tenantExport.create({ data: { tenantId, requestedBy: by, forDeletion: true } });
  });
  clearTenantCache();
  return { deleteAfter: after, exportId: exp.id };
}

export async function cancelDeletion(tenantId: string, by: string) {
  await withTenantTx(tenantId, async (tx) => {
    const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { deleteAfter: true } });
    if (!t.deleteAfter) throw new LifecycleError("No deletion is scheduled");
    await tx.tenant.update({ where: { id: tenantId }, data: { deleteRequestedAt: null, deleteAfter: null } });
    await tx.auditLog.create({ data: { actorId: by.startsWith("platform:") ? null : by, action: "tenant.delete_cancelled", entity: "Tenant", entityId: tenantId, after: { by } } });
  });
  clearTenantCache();
}

/** Daily: purge tenants whose grace period is over; expire old export files. */
export async function runLifecycle(now = new Date()) {
  const due = await asPlatform((tx) => tx.tenant.findMany({ where: { deleteAfter: { lte: now }, status: { not: "CLOSED" } }, select: { id: true } }));
  const purged: string[] = [];
  for (const t of due) {
    await purgeTenant(t.id, now);
    await prisma.platformAudit.create({ data: { action: "tenant.purged", targetTenantId: t.id } });
    purged.push(t.id);
  }
  // Expired exports: the file goes too (a full copy of a business's data shouldn't outlive its link).
  const old = await asPlatform((tx) => tx.tenantExport.findMany({ where: { status: "READY", expiresAt: { lte: now } }, select: { id: true, fileKey: true } }));
  for (const x of old) {
    if (x.fileKey) await deleteFile(x.fileKey).catch((e) => console.error("[lifecycle] export file", x.id, e));
  }
  const expired = await asPlatform((tx) => tx.tenantExport.updateMany({ where: { id: { in: old.map((x) => x.id) } }, data: { status: "EXPIRED" } }));
  return { purged, exportsExpired: expired.count };
}

/** Pause or un-pause a business by hand (platform console). */
export async function setSuspended(tenantId: string, suspended: boolean, reason: string | null) {
  await asPlatform(async (tx) => {
    const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { status: true } });
    if (t.status === "CLOSED") throw new LifecycleError("This business is closed");
    if (suspended) {
      if (!reason?.trim()) throw new LifecycleError("Say why the business is paused");
      await tx.tenant.update({ where: { id: tenantId }, data: { status: "SUSPENDED", suspendedAt: new Date(), suspendReason: reason.trim().slice(0, 200) } });
    } else {
      const sub = await tx.subscription.findUnique({ where: { tenantId } });
      await tx.tenant.update({ where: { id: tenantId }, data: { status: sub?.status === "TRIAL" ? "TRIAL" : "ACTIVE", suspendedAt: null, suspendReason: null } });
      if (sub?.status === "SUSPENDED") await tx.subscription.update({ where: { tenantId }, data: { status: "ACTIVE" } });
    }
  });
  clearTenantCache();
  invalidateEntitlements(tenantId);
}
