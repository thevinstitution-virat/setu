import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { cancelDeletion, LifecycleError, queueExport, requestDeletion } from "@/lib/tenant-data";

/** Is the business scheduled for deletion? */
export async function GET() {
  const auth = await guard("settings.manage");
  if (!auth.ok) return auth.res;
  return NextResponse.json({ slug: auth.tenant.slug, deleteAfter: auth.tenant.deleteAfter, status: auth.tenant.status });
}

/**
 * Delete the business and all its data (DPDP). Body: { confirm: "<the business's address name>" }.
 * A final copy is made at once; everything is deleted after 7 days unless cancelled.
 */
export async function POST(req: Request) {
  const auth = await guard("settings.manage");
  if (!auth.ok) return auth.res;
  if (auth.session.supportId) return NextResponse.json({ error: "Only the owner can delete the business" }, { status: 403 });
  const body = await req.json().catch(() => null);
  if (body?.confirm !== auth.tenant.slug) return NextResponse.json({ error: `Type ${auth.tenant.slug} to confirm` }, { status: 400 });
  try {
    const r = await requestDeletion(auth.tenant.id, auth.session.userId);
    await queueExport(auth.tenant.id, r.exportId);
    return NextResponse.json({ ok: true, deleteAfter: r.deleteAfter, exportId: r.exportId });
  } catch (e) {
    if (e instanceof LifecycleError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

/** Cancel a scheduled deletion. */
export async function DELETE() {
  const auth = await guard("settings.manage");
  if (!auth.ok) return auth.res;
  try {
    await cancelDeletion(auth.tenant.id, auth.session.userId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof LifecycleError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
