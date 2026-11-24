import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { withMoney } from "@/lib/ledger";
import { parseSupplier } from "@/lib/supplier-api";
import { supplierSummary } from "@/lib/purchases";

/** GET ?all=1: every supplier with what we owe them. POST: add a supplier (any kind). */
export async function GET(req: Request) {
  const auth = await guard("accounts.view");
  if (!auth.ok) return auth.res;
  const all = new URL(req.url).searchParams.get("all") === "1";
  const suppliers = await withMoney(auth.tenant.id, auth.session.userId, (ctx) => supplierSummary(ctx, { includeInactive: all }));
  return NextResponse.json({ suppliers }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  const auth = await guard("purchases.manage");
  if (!auth.ok) return auth.res;
  const b = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const data = parseSupplier(b, false);
  if (typeof data === "string") return NextResponse.json({ error: data }, { status: 400 });
  if (await auth.db.supplier.findFirst({ where: { name: { equals: data.name as string, mode: "insensitive" } } })) return NextResponse.json({ error: "That supplier is already added" }, { status: 409 });
  const supplier = await auth.db.supplier.create({ data: data as { name: string } });
  await audit(auth.db, { actorId: auth.session.userId, action: "supplier.create", entity: "Supplier", entityId: supplier.id, after: supplier, ip: requestIp(req) });
  return NextResponse.json({ supplier }, { status: 201 });
}
