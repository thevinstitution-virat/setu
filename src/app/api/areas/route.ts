import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function GET() {
  const regions = await prisma.region.findMany({
    include: { areas: { orderBy: { name: "asc" } } },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ regions });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const { name, regionId } = body ?? {};
  if (!name || !regionId) {
    return NextResponse.json({ error: "name and regionId are required" }, { status: 400 });
  }
  const area = await prisma.area.create({ data: { name, regionId } });
  return NextResponse.json({ area });
}
