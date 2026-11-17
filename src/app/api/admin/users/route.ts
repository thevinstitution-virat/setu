import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { hashPassword } from "@/lib/password";

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const users = await prisma.user.findMany({
    where: { role: { in: ["SALES_AGENT", "DELIVERY_AGENT"] } },
    include: { salesAgentProfile: true, deliveryAgentProfile: true },
    orderBy: { createdAt: "desc" },
  });
  const retailers = await prisma.retailerProfile.findMany({
    include: { user: true, area: { include: { region: true } }, salesAgent: { include: { user: true } } },
    orderBy: { outletName: "asc" },
  });
  return NextResponse.json({ users, retailers });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const { name, loginId, password, role } = body ?? {};

  if (!name || !loginId || !password || !["SALES_AGENT", "DELIVERY_AGENT"].includes(role)) {
    return NextResponse.json({ error: "name, loginId, password and a valid role are required" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { loginId } });
  if (existing) {
    return NextResponse.json({ error: "That login ID is already in use" }, { status: 400 });
  }

  const user = await prisma.user.create({
    data: {
      name,
      loginId,
      passwordHash: hashPassword(password),
      role,
      ...(role === "SALES_AGENT" ? { salesAgentProfile: { create: {} } } : {}),
      ...(role === "DELIVERY_AGENT" ? { deliveryAgentProfile: { create: {} } } : {}),
    },
  });

  return NextResponse.json({ user });
}
