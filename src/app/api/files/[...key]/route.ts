import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { getFile, keyBelongsTo, mayOpen } from "@/lib/storage";

export async function GET(_req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const auth = await guard();
  if (!auth.ok) return auth.res;
  const key = (await params).key.join("/");
  if (!keyBelongsTo(key, auth.tenant.id) || !mayOpen(key, auth.session.role)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const file = await getFile(key);
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": file.contentType,
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
