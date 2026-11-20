import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { withTenantTx } from "@/lib/db";
import { moneyFail } from "@/lib/money-api";
import { decide } from "@/lib/automation";

/** POST { accept: boolean, note?, retailerIds? } → accept (and apply) or reject one open suggestion. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard();
  if (!auth.ok) return auth.res;
  const { id } = await params;
  const b = (await req.json().catch(() => null)) as { accept?: unknown; note?: unknown; retailerIds?: unknown } | null;
  if (!b || typeof b.accept !== "boolean") return NextResponse.json({ error: "Say accept or reject" }, { status: 400 });
  if (b.note !== undefined && typeof b.note !== "string") return NextResponse.json({ error: "The note must be text" }, { status: 400 });
  if (b.retailerIds !== undefined && (!Array.isArray(b.retailerIds) || !b.retailerIds.every((x) => typeof x === "string"))) {
    return NextResponse.json({ error: "Pick shops by id" }, { status: 400 });
  }
  const who = { userId: auth.session.userId, role: auth.session.role };
  try {
    const r = await withTenantTx(
      auth.tenant.id,
      (tx) => decide({ tx, tenantId: auth.tenant.id, actorId: who.userId }, who, id, { accept: b.accept as boolean, note: b.note as string | undefined, retailerIds: b.retailerIds as string[] | undefined }),
      { timeout: 60_000 }
    );
    const ip = requestIp(req);
    for (const a of r.audits) await audit(auth.db, { actorId: who.userId, ...a, ip });
    if (r.status === "REJECTED") await audit(auth.db, { actorId: who.userId, action: "suggestion.reject", entity: "Suggestion", entityId: id, ip });
    return NextResponse.json({ status: r.status, result: r.status === "ACCEPTED" ? r.result : null });
  } catch (e) {
    return moneyFail(e);
  }
}
