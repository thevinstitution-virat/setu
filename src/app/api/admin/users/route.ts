import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { hashPassword } from "@/lib/password";
import { audit, requestIp } from "@/lib/audit";
import { checkStaffFields } from "@/lib/staff";
import { checkLimit, LimitError } from "@/lib/plans";

export async function GET() {
  const auth = await guard("team.view");
  if (!auth.ok) return auth.res;
  const { db } = auth;
  const users = await db.user.findMany({
    where: { role: { in: ["SALES_AGENT", "DELIVERY_AGENT", "SUPERVISOR"] } },
    omit: { passwordHash: true },
    include: { salesAgentProfile: true, deliveryAgentProfile: true, supervisor: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });
  const retailers = await db.retailerProfile.findMany({
    // Never send password hashes to the browser.
    include: {
      user: { omit: { passwordHash: true } },
      area: { include: { region: true } },
      salesAgent: { include: { user: { select: { id: true, name: true } } } },
    },
    orderBy: { outletName: "asc" },
  });
  return NextResponse.json({ users, retailers });
}

export async function POST(req: Request) {
  const auth = await guard("team.manage");
  if (!auth.ok) return auth.res;
  const { session, db } = auth;
  const body = await req.json().catch(() => null);
  const { name, loginId, password, role } = body ?? {};

  if (!name || !loginId || !password || !["SALES_AGENT", "DELIVERY_AGENT", "SUPERVISOR"].includes(role)) {
    return NextResponse.json({ error: "name, loginId, password and a valid role are required" }, { status: 400 });
  }
  const extra = await checkStaffFields(db, null, body);
  if ("error" in extra) return NextResponse.json({ error: extra.error }, { status: 400 });

  const existing = await db.user.findFirst({ where: { loginId } });
  if (existing) {
    return NextResponse.json({ error: "That login ID is already in use" }, { status: 400 });
  }

  try {
    await checkLimit(db, auth.tenant.id, "staff");
  } catch (e) {
    if (e instanceof LimitError) return NextResponse.json({ error: e.message, code: "limit" }, { status: 402 });
    throw e;
  }

  const user = await db.user.create({
    data: {
      name,
      loginId,
      passwordHash: hashPassword(password),
      role,
      ...extra.data,
      ...(role === "SALES_AGENT" ? { salesAgentProfile: { create: {} } } : {}),
      ...(role === "DELIVERY_AGENT" ? { deliveryAgentProfile: { create: {} } } : {}),
    },
  });

  await audit(db, { actorId: session.userId, action: "user.create", entity: "User", entityId: user.id, after: { name, loginId, role, ...extra.data }, ip: requestIp(req) });

  return NextResponse.json({ user: { id: user.id, name: user.name, loginId: user.loginId, role: user.role, active: user.active } });
}
