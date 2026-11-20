import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { withTenantTx } from "@/lib/db";
import { aiStatus } from "@/lib/ai";
import { listSuggestions } from "@/lib/automation";
import { isCatalogueField, missingCounts, runCatalogueAssist } from "@/lib/catalogue-assist";

/** A13: open catalogue suggestions, products missing a Hindi name or HSN code, and whether AI is available. */
export async function GET() {
  const auth = await guard("catalogue.manage");
  if (!auth.ok) return auth.res;
  const who = { userId: auth.session.userId, role: auth.session.role };
  const [list, missing, ai] = await Promise.all([
    withTenantTx(auth.tenant.id, (tx) => listSuggestions(tx, who, { status: "OPEN", kind: "catalogue", take: 200 })),
    missingCounts(auth.tenant.id),
    aiStatus(auth.tenant.id),
  ]);
  return NextResponse.json({
    items: list.items,
    missing,
    ai: ai.available ? { available: true, used: ai.used, cap: ai.cap } : { available: false, message: ai.message, used: ai.used, cap: ai.cap },
  });
}

/** POST { field: "nameHi" | "hsn" } → proposals for up to 100 products that lack it. */
export async function POST(req: Request) {
  const auth = await guard("catalogue.manage");
  if (!auth.ok) return auth.res;
  const b = (await req.json().catch(() => null)) as { field?: unknown } | null;
  if (!b || !isCatalogueField(b.field)) return NextResponse.json({ error: "Pick Hindi names or HSN codes" }, { status: 400 });
  const r = await runCatalogueAssist(auth.tenant.id, auth.session.userId, b.field);
  await audit(auth.db, { actorId: auth.session.userId, action: "catalogue.assist", entity: "Tenant", entityId: auth.tenant.id, after: { field: b.field, made: r.made, source: r.source, credits: r.credits }, ip: requestIp(req) });
  return NextResponse.json(r);
}
