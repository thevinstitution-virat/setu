import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";

/** Body: { name?, nameHi?, unitCharge?, active? }. Types are never deleted (history keeps them). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard("settings.manage");
  if (!auth.ok) return auth.res;
  const { id } = await params;
  const before = await auth.db.returnable.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json().catch(() => null)) ?? {};
  const data: { name?: string; nameHi?: string | null; unitCharge?: number; active?: boolean } = {};
  if ("name" in body) {
    const name = String(body.name ?? "").trim().slice(0, 40);
    if (!name) return NextResponse.json({ error: "Give it a name" }, { status: 400 });
    if (await auth.db.returnable.findFirst({ where: { name, NOT: { id } } })) return NextResponse.json({ error: "That name is already used" }, { status: 409 });
    data.name = name;
  }
  if ("nameHi" in body) data.nameHi = String(body.nameHi ?? "").trim().slice(0, 40) || null;
  if ("unitCharge" in body) {
    const c = Number(body.unitCharge);
    if (!Number.isInteger(c) || c < 0 || c > 10_000_00) return NextResponse.json({ error: "Charge must be between ₹0 and ₹10,000" }, { status: 400 });
    data.unitCharge = c;
  }
  if ("active" in body) data.active = body.active === true;
  const returnable = await auth.db.returnable.update({ where: { id }, data });
  await audit(auth.db, { actorId: auth.session.userId, action: "returnable.update", entity: "Returnable", entityId: id, before, after: returnable, ip: requestIp(req) });
  return NextResponse.json({ returnable });
}
