import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { can } from "@/lib/permissions";

/** Crate / jar types. Everyone signed in reads the active ones; settings.manage sees all. */
export async function GET() {
  const auth = await guard();
  if (!auth.ok) return auth.res;
  const all = can(auth.session.role, "settings.manage");
  const returnables = await auth.db.returnable.findMany({
    where: all ? undefined : { active: true },
    orderBy: [{ active: "desc" }, { sort: "asc" }, { name: "asc" }],
  });
  return NextResponse.json({ returnables });
}

/** Body: { name, nameHi?, unitCharge? (paise) } */
export async function POST(req: Request) {
  const auth = await guard("settings.manage");
  if (!auth.ok) return auth.res;
  const body = await req.json().catch(() => null);
  const name = String(body?.name ?? "").trim().slice(0, 40);
  if (!name) return NextResponse.json({ error: "Give it a name, like Crate or 20 L jar" }, { status: 400 });
  const unitCharge = body?.unitCharge === undefined ? 0 : Number(body.unitCharge);
  if (!Number.isInteger(unitCharge) || unitCharge < 0 || unitCharge > 10_000_00) {
    return NextResponse.json({ error: "Charge must be between ₹0 and ₹10,000" }, { status: 400 });
  }
  if (await auth.db.returnable.findFirst({ where: { name } })) return NextResponse.json({ error: "That name is already used" }, { status: 409 });
  const count = await auth.db.returnable.count();
  const returnable = await auth.db.returnable.create({
    data: { name, nameHi: String(body?.nameHi ?? "").trim().slice(0, 40) || null, unitCharge, sort: count },
  });
  await audit(auth.db, { actorId: auth.session.userId, action: "returnable.create", entity: "Returnable", entityId: returnable.id, after: returnable, ip: requestIp(req) });
  return NextResponse.json({ returnable }, { status: 201 });
}
