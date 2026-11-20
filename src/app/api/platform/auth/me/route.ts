import { NextResponse } from "next/server";
import { platformGuard } from "@/lib/platform-auth";

export async function GET() {
  const g = await platformGuard();
  if (!g.ok) return g.res;
  return NextResponse.json(g.session);
}
