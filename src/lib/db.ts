import { prisma } from "@/lib/prisma";
import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Tenant-scoped database access.
 *
 * Every tenant table is protected by Postgres row-level security keyed on the
 * transaction setting `app.tenant_id` (see prisma/migrations/*_init_postgres_tenancy).
 * tenantDb() wraps each query in a tiny transaction that first sets that value,
 * so a query can only ever read or write the current tenant's rows — even if
 * the code forgets a `where: { tenantId }`.
 *
 * New rows are stamped automatically: tenantId defaults to the same setting.
 */

function scoped(tenantId: string) {
  return prisma.$extends({
    name: "tenant-rls",
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const [, result] = await prisma.$transaction([
            prisma.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`,
            query(args),
          ]);
          return result;
        },
      },
    },
  });
}

export type TenantDb = ReturnType<typeof scoped>;

const cache = new Map<string, TenantDb>();

export function tenantDb(tenantId: string): TenantDb {
  if (!tenantId) throw new Error("tenantDb() needs a tenant id");
  let db = cache.get(tenantId);
  if (!db) {
    db = scoped(tenantId);
    cache.set(tenantId, db);
  }
  return db;
}

export type Tx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/**
 * Run several statements atomically inside one tenant. Use this (not
 * tenantDb) when a change must be all-or-nothing, e.g. order + stock + ledger.
 */
export async function withTenantTx<T>(
  tenantId: string,
  fn: (tx: Tx) => Promise<T>,
  options?: { timeout?: number }
): Promise<T> {
  if (!tenantId) throw new Error("withTenantTx() needs a tenant id");
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
      return fn(tx as Tx);
    },
    { timeout: options?.timeout ?? 15_000 }
  );
}

/**
 * Cross-tenant access for platform jobs only (billing, usage metering,
 * super-admin console). Never call this from a tenant request.
 */
export async function asPlatform<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', TRUE)`;
    return fn(tx as Tx);
  });
}
