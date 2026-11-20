import { NextResponse } from "next/server";
import { currentBrand } from "@/lib/branding-server";
import { manifestFor } from "@/lib/branding";

/** The installable-app manifest, in the business's own name, colours and icon. */
export async function GET() {
  const { tenant, brand } = await currentBrand();
  return NextResponse.json(manifestFor(brand, tenant?.name ?? null), {
    headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=300" },
  });
}
