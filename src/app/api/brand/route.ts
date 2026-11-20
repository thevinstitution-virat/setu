import { NextResponse } from "next/server";
import { currentBrand } from "@/lib/branding-server";
import { appNameOf, shortNameOf } from "@/lib/branding";

/** Public brand facts for the sign-in page: name, line, logo, and whether the business is paused. */
export async function GET() {
  const { tenant, brand } = await currentBrand();
  return NextResponse.json({
    business: !!tenant,
    appName: appNameOf(brand, tenant?.name),
    shortName: shortNameOf(brand, tenant?.name),
    tagline: brand.tagline ?? null,
    logoUrl: brand.logoKey ? "/brand/logo" : null,
    paused: tenant?.status === "SUSPENDED",
  });
}
