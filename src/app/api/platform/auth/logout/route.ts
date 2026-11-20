import { NextResponse } from "next/server";
import { clearPlatformCookie } from "@/lib/platform-auth";

export async function POST() {
  await clearPlatformCookie();
  return NextResponse.json({ ok: true, redirect: "/platform/login" });
}
