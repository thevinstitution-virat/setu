import { NextResponse } from "next/server";
import { localRedirect } from "@/lib/redirect";
import { currentBrand, brandImage } from "@/lib/branding-server";

const SIZES = new Set([32, 180, 192, 512]);

/** The business's app icon (square PNG), or ours. Public: the phone fetches it before sign-in. */
export async function GET(req: Request, ctx: RouteContext<"/brand/icon/[size]">) {
  const size = Number((await ctx.params).size);
  if (!SIZES.has(size)) return NextResponse.json({ error: "Size is 32, 180, 192 or 512" }, { status: 404 });
  const { brand } = await currentBrand();
  const img = await brandImage(brand.iconKey ?? brand.logoKey, size);
  if (!img) return localRedirect(size >= 512 ? "/icon-512.png" : "/icon-192.png");
  return new NextResponse(new Uint8Array(img.bytes), { headers: { "Content-Type": img.type, "Cache-Control": "public, max-age=300" } });
}
