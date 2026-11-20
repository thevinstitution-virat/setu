import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { getFile, keyBelongsTo } from "@/lib/storage";

/** Download a ready copy (gzipped JSON). */
export async function GET(req: Request, ctx: RouteContext<"/api/admin/export/[id]">) {
  const auth = await guard("settings.manage");
  if (!auth.ok) return auth.res;
  if (auth.session.supportId) return NextResponse.json({ error: "Support can't download the business's data" }, { status: 403 });
  const { id } = await ctx.params;
  const e = await auth.db.tenantExport.findUnique({ where: { id } });
  if (!e || e.status !== "READY" || !e.fileKey || !keyBelongsTo(e.fileKey, auth.tenant.id)) return NextResponse.json({ error: "Copy not found or expired" }, { status: 404 });
  const f = await getFile(e.fileKey);
  if (!f) return NextResponse.json({ error: "Copy not found" }, { status: 404 });
  await audit(auth.db, { actorId: auth.session.userId, action: "tenant.export_download", entity: "TenantExport", entityId: e.id, ip: requestIp(req) });
  const name = `${auth.tenant.slug}-data-${e.createdAt.toISOString().slice(0, 10)}.json.gz`;
  return new NextResponse(new Uint8Array(f.bytes), { headers: { "Content-Type": "application/gzip", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } });
}
