import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { redeliver } from "@/lib/webhooks";
import { emit } from "@/lib/jobs";

/** Send a failed or given-up delivery again (soon, by the worker). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard("integrations.manage");
  if (!auth.ok) return auth.res;
  const { session, db, tenant } = auth;
  const { id } = await params;
  const r = await redeliver(tenant.id, id);
  if (!r.count) return NextResponse.json({ error: "Only a failed delivery can be sent again" }, { status: 409 });
  await emit("webhooks.flush", { tenantId: tenant.id }, { singletonKey: `wh:${tenant.id}`, singletonSeconds: 3 });
  await audit(db, { actorId: session.userId, action: "webhook.redeliver", entity: "WebhookDelivery", entityId: id, ip: requestIp(req) });
  return NextResponse.json({ ok: true });
}
