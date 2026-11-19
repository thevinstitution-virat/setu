/**
 * Row-level security checks against the real database. Needs the seeded dev
 * database (npx prisma db seed). These are the Phase 0 exit tests: one tenant
 * can never read or write another tenant's rows, even by id.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { tenantDb, withTenantTx, asPlatform } from "@/lib/db";
import { nextOrderNumber } from "@/lib/orders";

let demoId = "";
let secondId = "";

beforeAll(async () => {
  const [demo, second] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { slug: "demo" } }),
    prisma.tenant.findUniqueOrThrow({ where: { slug: "second" } }),
  ]);
  demoId = demo.id;
  secondId = second.id;
});

afterAll(() => prisma.$disconnect());

/** Seeded products only: other test files add their own ("Test ..."). */
const seeded = { NOT: { name: { startsWith: "Test " } } };

describe("row-level security", () => {
  it("each tenant sees only its own rows", async () => {
    expect(await tenantDb(demoId).product.count({ where: seeded })).toBe(10);
    expect(await tenantDb(secondId).product.count({ where: seeded })).toBe(2);
  });

  it("the raw client without a tenant sees nothing (fails closed)", async () => {
    expect(await prisma.product.count()).toBe(0);
    expect(await prisma.user.count()).toBe(0);
  });

  it("the same phone and login id exist separately per tenant", async () => {
    const a = await tenantDb(demoId).user.findFirst({ where: { phone: "9876543210" } });
    const b = await tenantDb(secondId).user.findFirst({ where: { phone: "9876543210" } });
    expect(a?.name).toBe("Agarwal General Store");
    expect(b?.name).toBe("Sharma Stores");
    expect(a?.tenantId).toBe(demoId);
    expect(b?.tenantId).toBe(secondId);
  });

  it("cannot read another tenant's row by id", async () => {
    const demoProduct = await tenantDb(demoId).product.findFirstOrThrow();
    expect(await tenantDb(secondId).product.findUnique({ where: { id: demoProduct.id } })).toBeNull();
  });

  it("cannot update or delete another tenant's row by id", async () => {
    const demoProduct = await tenantDb(demoId).product.findFirstOrThrow();
    await expect(
      tenantDb(secondId).product.update({ where: { id: demoProduct.id }, data: { name: "hacked" } })
    ).rejects.toThrow();
    const res = await tenantDb(secondId).product.deleteMany({ where: { id: demoProduct.id } });
    expect(res.count).toBe(0);
    const still = await tenantDb(demoId).product.findUniqueOrThrow({ where: { id: demoProduct.id } });
    expect(still.name).not.toBe("hacked");
  });

  it("cannot insert a row stamped with another tenant's id", async () => {
    await expect(
      tenantDb(secondId).region.create({ data: { name: "Smuggled", tenantId: demoId } })
    ).rejects.toThrow();
  });

  it("stamps tenantId automatically on create", async () => {
    const r = await tenantDb(secondId).region.create({ data: { name: `Auto ${Date.now()}` } });
    expect(r.tenantId).toBe(secondId);
    await tenantDb(secondId).region.delete({ where: { id: r.id } });
  });

  it("audit log is append-only", async () => {
    const db = tenantDb(secondId);
    const row = await db.auditLog.create({ data: { action: "test.append", entity: "Test" } });
    const upd = await db.auditLog.updateMany({ where: { id: row.id }, data: { action: "tampered" } });
    const del = await db.auditLog.deleteMany({ where: { id: row.id } });
    expect(upd.count).toBe(0);
    expect(del.count).toBe(0);
  });

  it("order numbers are gap-free per tenant inside transactions", async () => {
    const nums = await Promise.all(
      Array.from({ length: 5 }, () => withTenantTx(secondId, (tx) => nextOrderNumber(tx, secondId)))
    );
    const seqs = nums.map((n) => Number(n.split("-")[2])).sort((a, b) => a - b);
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBe(seqs[i - 1] + 1);
  });

  it("platform jobs can read across tenants only via asPlatform", async () => {
    const n = await asPlatform((tx) => tx.product.count({ where: seeded }));
    expect(n).toBe(12);
  });

  it("every table with a tenantId has forced row-level security and a policy", async () => {
    const rows = await prisma.$queryRaw<{ table: string; rls: boolean; forced: boolean; policies: number }[]>`
      SELECT c.relname AS "table", c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
             (SELECT count(*)::int FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
      FROM information_schema.columns col
      JOIN pg_class c ON c.relname = col.table_name
      JOIN pg_namespace ns ON ns.oid = c.relnamespace AND ns.nspname = 'public'
      WHERE col.table_schema = 'public' AND col.column_name = 'tenantId' AND c.relname <> 'TenantDomain'`;
    expect(rows.length).toBeGreaterThan(40);
    expect(rows.filter((r) => !r.rls || !r.forced || r.policies < 1).map((r) => r.table)).toEqual([]);
  });
});
