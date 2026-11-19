import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { ALLOWED_TYPES, newKey, putFile, sniffType } from "@/lib/storage";

const MAX_BYTES = 3 * 1024 * 1024;
const KINDS = new Set(["pod-photo", "pod-signature", "product-image", "shop-photo", "selfie", "store-photo", "visit-photo", "payment-proof", "banner", "brand-logo", "category-image", "ticket-photo", "announcement"]);

/** multipart/form-data: file, kind → { key } */
export async function POST(req: Request) {
  const auth = await guard();
  if (!auth.ok) return auth.res;
  const { tenant } = auth;

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const kind = String(form?.get("kind") ?? "");
  if (!(file instanceof Blob)) return NextResponse.json({ error: "No file attached" }, { status: 400 });
  if (!KINDS.has(kind)) return NextResponse.json({ error: "Unknown upload kind" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File is larger than 3 MB" }, { status: 413 });

  const bytes = Buffer.from(await file.arrayBuffer());
  const type = sniffType(bytes);
  if (!type || !ALLOWED_TYPES.includes(type)) {
    return NextResponse.json({ error: "Only JPEG, PNG, WebP or PDF files" }, { status: 415 });
  }

  const key = newKey(tenant.id, kind, type);
  await putFile(key, bytes, type);
  return NextResponse.json({ key });
}
