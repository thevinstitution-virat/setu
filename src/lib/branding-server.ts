import { getTenant, type CurrentTenant } from "@/lib/tenant";
import { entitlements } from "@/lib/plans";
import { effectiveBrand, parseBrand, type Brand } from "@/lib/branding";
import { getFile } from "@/lib/storage";

/** The brand shown on this request's host (ours on the platform address). */
export async function currentBrand(): Promise<{ tenant: CurrentTenant | null; brand: Brand }> {
  const tenant = await getTenant();
  if (!tenant) return { tenant: null, brand: {} };
  const wl = (await entitlements(tenant.id)).features.has("whiteLabel");
  return { tenant, brand: effectiveBrand(parseBrand(tenant.brand), wl) };
}

/** A brand picture (logo or icon) resized to a square PNG, or null. */
export async function brandImage(key: string | undefined, size: number | null): Promise<{ bytes: Buffer; type: string } | null> {
  if (!key) return null;
  const f = await getFile(key);
  if (!f) return null;
  if (!size) return { bytes: f.bytes, type: f.contentType };
  try {
    const sharp = (await import("sharp")).default;
    const bytes = await sharp(f.bytes).resize(size, size, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } }).png().toBuffer();
    return { bytes, type: "image/png" };
  } catch {
    return { bytes: f.bytes, type: f.contentType };
  }
}
