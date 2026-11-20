import { NextResponse } from "next/server";
import { currentBrand, brandImage } from "@/lib/branding-server";

/** The business's logo as uploaded (public: shown on the sign-in page). 404 when none. */
export async function GET() {
  const { brand } = await currentBrand();
  const img = await brandImage(brand.logoKey, null);
  if (!img) return NextResponse.json({ error: "No logo" }, { status: 404 });
  return new NextResponse(new Uint8Array(img.bytes), { headers: { "Content-Type": img.type, "Cache-Control": "public, max-age=300" } });
}
