import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const regions = await prisma.region.findMany({
    include: { areas: true },
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
  const { name } = body ?? {};
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  const region = await prisma.region.create({ data: { name } });
  return NextResponse.json({ region });
}
