import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { withTenantTx } from "@/lib/db";
import { bad, GST_RATES, optText } from "@/lib/catalogue-api";

/** HSN codes with their GST rate and how many products use each. */
export async function GET() {
  const auth = await guard("catalogue.manage");
  if (!auth.ok) return auth.res;
  const [codes, used] = await Promise.all([
    auth.db.hsnCode.findMany({ orderBy: { code: "asc" } }),
    auth.db.product.groupBy({ by: ["hsnCode"], where: { hsnCode: { not: null } }, _count: { _all: true } }),
  ]);
  const count = new Map(used.map((u) => [u.hsnCode, u._count._all]));
  return NextResponse.json({ codes: codes.map((c) => ({ ...c, products: count.get(c.code) ?? 0 })) });
}

/** Add or change a code: { code, gstRate, description? }. Every product with this code gets the new rate. */
export async function POST(req: Request) {
  const auth = await guard("catalogue.manage");
  if (!auth.ok) return auth.res;
  const { db, session, tenant } = auth;
  const b = (await req.json().catch(() => null)) ?? {};
  const code = typeof b.code === "string" ? b.code.trim() : "";
  if (!/^\d{4,8}$/.test(code)) return bad("HSN code must be 4 to 8 digits");
  const rate = Number(b.gstRate);
  if (!GST_RATES.includes(rate)) return bad(`GST must be one of ${GST_RATES.join(", ")}%`);
  const description = optText(b.description, 160);
  const { row, updated } = await withTenantTx(tenant.id, async (tx) => {
    const row = await tx.hsnCode.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code } },
      create: { code, gstRate: rate, description },
      update: { gstRate: rate, ...("description" in b ? { description } : {}) },
    });
    const updated = await tx.product.updateMany({ where: { hsnCode: code, gstRate: { not: rate } }, data: { gstRate: rate } });
    return { row, updated: updated.count };
  });
  await audit(db, { actorId: session.userId, action: "hsn.upsert", entity: "HsnCode", entityId: row.id, after: { ...row, productsUpdated: updated }, ip: requestIp(req) });
  return NextResponse.json({ code: row, productsUpdated: updated });
}
