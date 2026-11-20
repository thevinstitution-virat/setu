/**
 * Password hashes are omitted by the Prisma client itself (src/lib/prisma.ts), so no
 * route can leak them through an `include: { user: true }`. Only login opts back in.
 */
import "dotenv/config";
import { expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/db";

it("never returns password hashes unless a query asks for them", async () => {
  const t = await prisma.tenant.findUniqueOrThrow({ where: { slug: "demo" } });
  const db = tenantDb(t.id);
  const order = await db.order.findFirstOrThrow({
    include: { retailer: { include: { user: true } }, delivery: { include: { deliveryAgent: { include: { user: true } } } } },
  });
  expect(JSON.stringify(order)).not.toContain("passwordHash");
  const admin = await db.user.findFirstOrThrow({ where: { loginId: "admin" } });
  expect("passwordHash" in admin).toBe(false);
  const login = await db.user.findFirstOrThrow({ where: { loginId: "admin" }, omit: { passwordHash: false } });
  expect(login.passwordHash).toBeTruthy();
});
